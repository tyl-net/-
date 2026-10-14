// 数据库层：node:sqlite 建库建表 + 种子数据
// 表结构与《系统设计说明书》4.2 逻辑结构设计一致（t_user/t_goods/t_order/t_review/t_admin），
// 并按功能需要补充 公告、举报、审计日志 三张表。
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 数据库放在项目目录之外（工作区 .data/）：部署只上传代码、不携带运行数据，
// 避免"本地测试数据随发布覆盖线上"；可用 DB_DATA_DIR 环境变量覆盖。
const DATA_DIR = process.env.DB_DATA_DIR || path.join(__dirname, '..', '..', '.data');

/** 打开数据库：优先落盘 SQLite；只读/受限环境自动回退到内存库，保证仍可运行 */
function openDatabase() {
  const file = process.env.DB_FILE || path.join(DATA_DIR, 'market.db');
  if (file === ':memory:') return new DatabaseSync(':memory:');
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const d = new DatabaseSync(file);
    d.exec('PRAGMA journal_mode = WAL;');
    return d;
  } catch (err) {
    console.warn('[db] 文件数据库不可用，已回退到内存数据库（重启后数据重置）:', err.message);
    return new DatabaseSync(':memory:');
  }
}

export const db = openDatabase();
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS t_user (
  user_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  student_no   VARCHAR(20)  NOT NULL UNIQUE,
  password     VARCHAR(200) NOT NULL,
  nickname     VARCHAR(50)  NOT NULL,
  phone        VARCHAR(20),
  real_name    VARCHAR(30),
  email        VARCHAR(60),
  avatar       VARCHAR(200),
  credit_score INTEGER      DEFAULT 100,
  is_verified  INTEGER      DEFAULT 0,
  status       INTEGER      DEFAULT 1,
  fail_count   INTEGER      DEFAULT 0,
  lock_until   DATETIME,
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_goods (
  goods_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id    INTEGER NOT NULL REFERENCES t_user(user_id),
  title        VARCHAR(100) NOT NULL,
  category     VARCHAR(30)  NOT NULL,
  price        DECIMAL(10,2) NOT NULL,
  quality      VARCHAR(20),
  description  TEXT,
  images       VARCHAR(500),
  audit_status INTEGER      DEFAULT 0,
  audit_remark VARCHAR(200),
  goods_status INTEGER      DEFAULT 1,
  is_deleted   INTEGER      DEFAULT 0,
  view_count   INTEGER      DEFAULT 0,
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  audited_at   DATETIME
);

CREATE TABLE IF NOT EXISTS t_order (
  order_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no     VARCHAR(32)  NOT NULL UNIQUE,
  buyer_id     INTEGER NOT NULL REFERENCES t_user(user_id),
  seller_id    INTEGER NOT NULL REFERENCES t_user(user_id),
  goods_id     INTEGER NOT NULL REFERENCES t_goods(goods_id),
  amount       DECIMAL(10,2) NOT NULL,
  order_status INTEGER      NOT NULL DEFAULT 0,
  pay_time     DATETIME,
  finish_time  DATETIME,
  cancel_reason VARCHAR(200),
  cancel_by     INTEGER,
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_review (
  review_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL UNIQUE REFERENCES t_order(order_id),
  user_id    INTEGER NOT NULL REFERENCES t_user(user_id),
  goods_id   INTEGER NOT NULL REFERENCES t_goods(goods_id),
  score      INTEGER NOT NULL,
  content    VARCHAR(500),
  reply      VARCHAR(500),
  additional VARCHAR(500),
  additional_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_admin (
  admin_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  account    VARCHAR(30)  NOT NULL UNIQUE,
  password   VARCHAR(200) NOT NULL,
  name       VARCHAR(30),
  role       INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_announcement (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      VARCHAR(100) NOT NULL,
  content    TEXT NOT NULL,
  status     INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_report (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id   INTEGER NOT NULL REFERENCES t_user(user_id),
  target_type   VARCHAR(10) NOT NULL,
  target_id     INTEGER NOT NULL,
  reason        VARCHAR(200) NOT NULL,
  status        INTEGER DEFAULT 0,
  handle_remark VARCHAR(200),
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type VARCHAR(10),
  actor_id   INTEGER,
  action     VARCHAR(50),
  detail     VARCHAR(300),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_goods_seller ON t_goods(seller_id);
CREATE INDEX IF NOT EXISTS idx_goods_audit  ON t_goods(audit_status, goods_status);
CREATE INDEX IF NOT EXISTS idx_goods_cat    ON t_goods(category);
CREATE INDEX IF NOT EXISTS idx_order_buyer  ON t_order(buyer_id);
CREATE INDEX IF NOT EXISTS idx_order_seller ON t_order(seller_id);
`;

db.exec(SCHEMA);

// ---------- 轻量迁移：为已有数据库补充后加的列 ----------
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
// 商品软删除标记：删除时置 1，各查询按 is_deleted=0 过滤，保证历史订单/评价的引用完整
ensureColumn('t_goods', 'is_deleted', 'is_deleted INTEGER DEFAULT 0');

// 取消订单（v1.1）：必填取消原因，记录取消操作人
ensureColumn('t_order', 'cancel_reason', 'cancel_reason VARCHAR(200)');
ensureColumn('t_order', 'cancel_by', 'cancel_by INTEGER');

// 追加评价（v1.1）：评价发表后可补充一次使用感受，限一次
ensureColumn('t_review', 'additional', 'additional VARCHAR(500)');
ensureColumn('t_review', 'additional_at', 'additional_at DATETIME');

// 数据修复（v1.1.1）：头像功能联调期间演示账号昵称被测试脚本误改，此处幂等修正
db.prepare("UPDATE t_user SET nickname='李思远', avatar='李' WHERE student_no='241603010301' AND nickname<>'李思远'").run();

// 商品类别（与前端下拉一致）
export const CATEGORIES = ['教材书籍', '电子数码', '生活用品', '体育运动', '服饰美妆', '其他'];
export const QUALITIES = ['全新', '九成新', '八成新', '七成新及以下'];
export const ORDER_STATUS = ['待支付', '待发货', '待收货', '已完成', '已取消'];
export const AUDIT_STATUS = ['待审核', '审核通过', '审核驳回'];

/** 审计日志 */
export function audit(actorType, actorId, action, detail = '') {
  db.prepare(
    'INSERT INTO t_audit_log(actor_type,actor_id,action,detail) VALUES(?,?,?,?)'
  ).run(actorType, actorId, action, detail);
}

function isEmpty() {
  const r = db.prepare('SELECT COUNT(*) AS c FROM t_user').get();
  return Number(r.c) === 0;
}

/** 一次性灌入演示数据，让系统开箱即有内容 */
export function seedIfEmpty() {
  if (!isEmpty()) return false;

  const pwd = hashPassword('123456');
  const insUser = db.prepare(
    `INSERT INTO t_user(student_no,password,nickname,phone,real_name,email,credit_score,is_verified,status,avatar)
     VALUES(?,?,?,?,?,?,?,?,?,?)`
  );
  const users = [
    ['241603010213', '谭以勒', '13800000001', '谭以勒', 'tanye@campus.edu', 108, 1, 1, '谭'],
    ['241603010301', '李思远', '13800000002', '李思远', 'lisy@campus.edu', 108, 1, 1, '李'],
    ['241603010415', '王雨桐', '13800000003', '王雨桐', 'wangyt@campus.edu', 108, 1, 1, '王'],
    ['241603010522', '陈嘉禾', '13800000004', '陈嘉禾', 'chenjh@campus.edu', 100, 1, 1, '陈'],
    ['241603010607', '赵一鸣', '13800000005', '赵一鸣', 'zhaoym@campus.edu', 100, 0, 1, '赵'],
    ['241603010718', '周未然', '13800000006', '周未然', 'zhouwr@campus.edu', 100, 1, 0, '周'],
  ];
  users.forEach((u) => insUser.run(u[0], pwd, u[1], u[2], u[3], u[4], u[5], u[6], u[7], u[8]));

  const insGoods = db.prepare(
    `INSERT INTO t_goods(seller_id,title,category,price,quality,description,images,audit_status,goods_status,view_count,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`
  );
  // [卖家, 标题, 类别, 价格, 成色, 描述, 审核, 状态, 浏览量, 发布时间]
  const goods = [
    [1, '《软件工程》张海藩 第5版 教材', '教材书籍', 18.0, '九成新', '正版教材，仅前两章有少量笔记，无水渍无缺页，考研复习自用出。', 1, 2, 236, '2026-09-12 10:20:00'],
    [1, '罗技 MX Master 3S 无线鼠标', '电子数码', 429.0, '九成新', '毕业出，包装配件齐全，按键顺滑无可感知磨损，成都本地可当面交易。', 1, 2, 512, '2026-09-14 15:03:00'],
    [2, 'Kindle Paperwhite 5 电子书阅读器', '电子数码', 480.0, '八成新', '8G 版，屏幕无划痕，背光正常，附送原装保护套，可小刀。', 1, 1, 388, '2026-09-16 09:41:00'],
    [2, '《考研数学 660 题》数学一', '教材书籍', 22.0, '八成新', '刷过一遍，答案完整，铅笔痕迹可擦，笔记为荧光笔标注。', 1, 1, 174, '2026-09-18 19:22:00'],
    [1, '尤克里里 23 寸 单板', '体育运动', 168.0, '九成新', '学长毕业转让，配调音器与琴包，音色清亮，适合新手入门。', 1, 1, 143, '2026-09-20 11:08:00'],
    [3, '宿舍用静音迷你小风扇', '生活用品', 25.0, '九成新', 'USB 供电，三档风力，静音马达，夏天宿舍神器，用了一个季度。', 1, 1, 92, '2026-09-21 14:37:00'],
    [3, 'NIKE Air Zoom 跑鞋 42码', '体育运动', 199.0, '八成新', '仅跑过大约 50 公里，鞋底磨损轻微，鞋面干净已清洗。', 1, 2, 207, '2026-09-22 08:15:00'],
    [2, '大学英语四级真题（近5年）', '教材书籍', 12.0, '七成新及以下', '做过部分题目，适合刷题练手，价格便宜，笔记较多。', 1, 1, 61, '2026-09-23 16:50:00'],
    [4, '美的 4L 电饭煲', '生活用品', 89.0, '八成新', '毕业离校出，内胆无涂层脱落，蒸煮功能正常，限校内自提。', 1, 1, 118, '2026-09-24 12:30:00'],
    [5, 'Beats Studio3 头戴耳机', '电子数码', 599.0, '九成新', '主动降噪，续航优秀，附收纳盒，因换设备闲置转让。', 0, 1, 45, '2026-10-08 20:10:00'],
    [5, '宜家 台灯 可调光护眼', '生活用品', 45.0, '九成新', '可三档调光，灯珠无频闪，含原装电源适配器。', 0, 1, 33, '2026-10-08 21:05:00'],
    [4, '过期食品大礼包（勿拍，测试用）', '其他', 1.0, '全新', '违规测试商品：售卖过期食品。', 2, 0, 8, '2026-10-08 22:00:00'],
    [2, '宿舍折叠小书桌 白色', '生活用品', 55.0, '九成新', '桌面无划痕，可折叠收纳，承重良好，仅限校内自提。', 1, 2, 96, '2026-09-05 10:12:00'],
    [3, '膳魔师保温杯 500ml', '生活用品', 39.0, '全新', '全新未拆封，朋友送重了，保温效果极佳。', 1, 1, 58, '2026-09-27 09:05:00'],
    [4, '《离散数学》左孝凌 教材', '教材书籍', 25.0, '九成新', '计算机专业教材，书况良好，附赠手写笔记一份。', 1, 1, 73, '2026-09-29 15:40:00'],
  ];
  goods.forEach((g) =>
    insGoods.run(g[0], g[1], g[2], g[3], g[4], g[5], '', g[6], g[7], g[8], g[9])
  );

  const insOrder = db.prepare(
    `INSERT INTO t_order(order_no,buyer_id,seller_id,goods_id,amount,order_status,pay_time,finish_time,cancel_reason,cancel_by,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  // [订单号, 买家, 卖家, 商品, 金额, 状态, 支付时间, 完成时间, 创建时间, [取消原因, 取消人]]
  const orders = [
    ['CM202609220850001', 1, 3, 7, 199.0, 3, '2026-09-22 08:56:00', '2026-09-24 10:00:00', '2026-09-22 08:50:00', null],
    ['CM202609261420002', 1, 2, 3, 480.0, 2, '2026-09-26 14:31:00', null, '2026-09-26 14:20:00', null],
    ['CM202610092010003', 1, 2, 4, 22.0, 0, null, null, '2026-10-09 20:10:00', null],
    ['CM202609150935004', 2, 1, 2, 429.0, 3, '2026-09-15 09:41:00', '2026-09-17 16:00:00', '2026-09-15 09:35:00', null],
    ['CM202609131015005', 3, 1, 1, 18.0, 3, '2026-09-13 10:18:00', '2026-09-15 09:30:00', '2026-09-13 10:15:00', null],
    ['CM202610081100006', 4, 1, 5, 168.0, 1, '2026-10-08 11:05:00', null, '2026-10-08 11:00:00', null],
    ['CM202609281920007', 5, 3, 8, 12.0, 4, null, null, '2026-09-28 19:20:00', ['拍错了教材版本，重新下单了', 5]],
    ['CM202609061030008', 4, 2, 13, 55.0, 3, '2026-09-06 10:36:00', '2026-09-08 12:20:00', '2026-09-06 10:30:00', null],
  ];
  orders.forEach((o) =>
    insOrder.run(o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7], o[9] ? o[9][0] : null, o[9] ? o[9][1] : null, o[8], o[8])
  );

  const insReview = db.prepare(
    `INSERT INTO t_review(order_id,user_id,goods_id,score,content,reply,additional,additional_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)`
  );
  insReview.run(1, 1, 7, 5, '跑鞋和描述一致，几乎没磨损，卖家还送了一双鞋垫，很靠谱！', '谢谢！祝你跑步愉快～', '穿了两周来追加：缓震依旧在线，已经跑了十公里没有开胶，这单很值。', '2026-10-08 21:30:00', '2026-09-24 10:30:00');
  insReview.run(4, 2, 2, 5, '鼠标成色很好，包装配件都齐全，卖家沟通很顺畅。', '感谢支持，欢迎再来！', null, null, '2026-09-17 16:40:00');
  insReview.run(5, 3, 1, 4, '教材和描述一致，价格实惠，就是书角稍微有点折。', '谢谢同学反馈，祝你考研顺利！', null, null, '2026-09-15 10:02:00');
  insReview.run(8, 4, 13, 5, '书桌很结实，卖家帮忙搬到了宿舍楼下，好评！', null, null, null, '2026-09-08 13:00:00');

  // 管理员：admin / 123456（超级管理员）、auditor / 123456（普通管理员）
  const insAdmin = db.prepare(
    'INSERT INTO t_admin(account,password,name,role) VALUES(?,?,?,?)'
  );
  insAdmin.run('admin', pwd, '平台超级管理员', 2);
  insAdmin.run('auditor', pwd, '内容审核员', 1);

  const insAnn = db.prepare('INSERT INTO t_announcement(title,content,status) VALUES(?,?,?)');
  insAnn.run('平台交易公约', '请勿交易违禁物品；建议校内当面验货；交易纠纷可向管理员举报。', 1);
  insAnn.run('开学季闲置专场', '开学季闲置交易专场已开启，发布商品有机会获得推荐位曝光。', 1);

  const insReport = db.prepare(
    'INSERT INTO t_report(reporter_id,target_type,target_id,reason,status) VALUES(?,?,?,?,?)'
  );
  insReport.run(3, 'goods', 12, '该商品疑似售卖过期食品，存在食品安全风险，请核查。', 0);
  insReport.run(4, 'user', 6, '该用户连续多次发布不实描述商品，怀疑是骗子账号。', 1);

  // 初始审计日志（历史操作留痕）
  const insLog = db.prepare(
    'INSERT INTO t_audit_log(actor_type,actor_id,action,detail,created_at) VALUES(?,?,?,?,?)'
  );
  [
    ['admin', 1, 'ADMIN_LOGIN', 'admin', '2026-09-12 09:02:00'],
    ['user', 1, 'GOODS_PUBLISH', '#1 《软件工程》张海藩 第5版 教材', '2026-09-12 10:20:00'],
    ['admin', 1, 'GOODS_AUDIT', '#1 审核通过 内容合规', '2026-09-12 11:15:00'],
    ['user', 3, 'ORDER_CREATE', 'CM202609131015005 商品#1', '2026-09-13 10:15:00'],
    ['user', 3, 'ORDER_PAY', 'CM202609131015005', '2026-09-13 10:18:00'],
    ['user', 1, 'ORDER_CONFIRM', 'CM202609131015005', '2026-09-15 09:30:00'],
    ['system', null, 'ORDER_SETTLE', 'CM202609131015005 结算 ¥18.00 至卖家#1', '2026-09-15 09:30:00'],
    ['user', 3, 'REVIEW_CREATE', '订单#5 4分', '2026-09-15 10:02:00'],
    ['admin', 2, 'GOODS_AUDIT', '#12 审核驳回 售卖过期食品', '2026-10-08 22:20:00'],
    ['admin', 1, 'REPORT_HANDLE', '#2 成立 举报成立，已禁用账号', '2026-09-30 10:20:00'],
    ['admin', 1, 'USER_DISABLE', '#6 周未然', '2026-09-30 10:20:00'],
  ].forEach((l) => insLog.run(l[0], l[1], l[2], l[3], l[4]));

  return true;
}
