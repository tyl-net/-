// 用户管理模块：注册、登录、资料、实名认证、修改密码、卖家主页
import { db, audit } from '../db.js';
import { hashPassword, verifyPassword, signToken, requireUser, currentUser } from '../auth.js';
import { ok, bad, notFound, forbidden, normalizeGoodsRow } from '../util.js';

const MAX_FAIL = 5;         // 连续 5 次失败锁定
const LOCK_MINUTES = 10;    // 锁定 10 分钟

function publicUser(u) {
  return {
    user_id: u.user_id,
    student_no: u.student_no,
    nickname: u.nickname,
    phone: u.phone,
    email: u.email,
    avatar: u.avatar,
    real_name: u.real_name,
    credit_score: u.credit_score,
    is_verified: u.is_verified,
    status: u.status,
    created_at: u.created_at,
  };
}

export function registerUser(router) {
  // 用户注册（校园邮箱/学号认证注册）
  router.post('/api/user/register', async (req, res, body) => {
    const student_no = String(body.student_no || '').trim();
    const password = String(body.password || '');
    const nickname = String(body.nickname || '').trim();
    const phone = String(body.phone || '').trim();

    if (!/^\d{6,20}$/.test(student_no)) throw bad('学号格式不正确（应为 6~20 位数字）');
    if (password.length < 6) throw bad('密码长度至少 6 位');
    if (nickname.length < 2 || nickname.length > 20) throw bad('昵称长度应为 2~20 个字符');
    if (phone && !/^1\d{10}$/.test(phone)) throw bad('手机号格式不正确');

    const exists = db.prepare('SELECT user_id FROM t_user WHERE student_no=?').get(student_no);
    if (exists) throw bad('该学号已注册，请直接登录');

    const r = db
      .prepare(
        'INSERT INTO t_user(student_no,password,nickname,phone,avatar) VALUES(?,?,?,?,?)'
      )
      .run(student_no, hashPassword(password), nickname, phone || null, nickname.slice(0, 1));
    const u = db.prepare('SELECT * FROM t_user WHERE user_id=?').get(Number(r.lastInsertRowid));
    audit('user', u.user_id, 'REGISTER', `学号 ${student_no}`);
    return ok(res, { user: publicUser(u) }, '注册成功');
  });

  // 用户登录（返回 JWT 令牌）
  router.post('/api/user/login', async (req, res, body) => {
    const account = String(body.student_no || body.account || '').trim();
    const password = String(body.password || '');
    if (!account || !password) throw bad('请输入学号与密码');

    const u = db.prepare('SELECT * FROM t_user WHERE student_no=?').get(account);
    if (!u) throw bad('账号或密码错误');

    if (u.lock_until && new Date(u.lock_until.replace(' ', 'T')) > new Date()) {
      throw forbidden(`账号已被锁定，请于 ${u.lock_until} 后重试`);
    }
    if (u.status === 0) throw forbidden('账号已被管理员禁用，请联系平台管理员');

    if (!verifyPassword(password, u.password)) {
      const fail = Number(u.fail_count || 0) + 1;
      if (fail >= MAX_FAIL) {
        const until = new Date(Date.now() + LOCK_MINUTES * 60000)
          .toISOString()
          .slice(0, 19)
          .replace('T', ' ');
        db.prepare('UPDATE t_user SET fail_count=0, lock_until=? WHERE user_id=?').run(until, u.user_id);
        audit('user', u.user_id, 'LOGIN_LOCK', `连续 ${MAX_FAIL} 次密码错误`);
        throw forbidden(`连续 ${MAX_FAIL} 次密码错误，账号锁定 ${LOCK_MINUTES} 分钟`);
      }
      db.prepare('UPDATE t_user SET fail_count=? WHERE user_id=?').run(fail, u.user_id);
      throw bad(`账号或密码错误（已失败 ${fail}/${MAX_FAIL} 次）`);
    }

    db.prepare('UPDATE t_user SET fail_count=0, lock_until=NULL WHERE user_id=?').run(u.user_id);
    const token = signToken({ sub: u.user_id, type: 'user', nickname: u.nickname });
    audit('user', u.user_id, 'LOGIN', u.student_no);
    return ok(res, { token, user: publicUser(u) }, '登录成功');
  });

  // 当前登录用户资料
  router.get('/api/user/profile', async (req, res) => {
    const me = requireUser(req);
    const u = db.prepare('SELECT * FROM t_user WHERE user_id=?').get(me.sub);
    if (!u) throw notFound('用户不存在');
    const stat = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM t_goods WHERE seller_id=?) AS goods_count,
           (SELECT COUNT(*) FROM t_order WHERE buyer_id=?) AS buy_count,
           (SELECT COUNT(*) FROM t_order WHERE seller_id=?) AS sell_count,
           (SELECT IFNULL(ROUND(AVG(score),1),0) FROM t_review r JOIN t_goods g ON r.goods_id=g.goods_id WHERE g.seller_id=?) AS avg_score`
      )
      .get(u.user_id, u.user_id, u.user_id, u.user_id);
    return ok(res, { user: publicUser(u), stat });
  });

  // 修改个人资料：字段均可选，仅更新传入的字段（未传 avatar 不影响已上传头像）
  router.put('/api/user/profile', async (req, res, body) => {
    const me = requireUser(req);
    const sets = [];
    const args = [];
    if (body.nickname !== undefined) {
      const nickname = String(body.nickname || '').trim();
      if (nickname.length < 2 || nickname.length > 20) throw bad('昵称长度应为 2~20 个字符');
      sets.push('nickname=?'); args.push(nickname);
    }
    if (body.phone !== undefined) {
      const phone = String(body.phone || '').trim();
      if (phone && !/^1\d{10}$/.test(phone)) throw bad('手机号格式不正确');
      sets.push('phone=?'); args.push(phone || null);
    }
    if (body.email !== undefined) {
      const email = String(body.email || '').trim();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('邮箱格式不正确');
      sets.push('email=?'); args.push(email || null);
    }
    if (body.avatar !== undefined && String(body.avatar || '').trim() !== '') {
      const avatar = String(body.avatar).trim();
      if (avatar.length > 500_000) throw bad('头像图片过大，请压缩后重试');
      sets.push('avatar=?'); args.push(avatar);
    }
    if (!sets.length) throw bad('没有需要更新的内容');
    args.push(me.sub);
    db.prepare(`UPDATE t_user SET ${sets.join(', ')} WHERE user_id=?`).run(...args);
    const u = db.prepare('SELECT * FROM t_user WHERE user_id=?').get(me.sub);
    return ok(res, { user: publicUser(u) }, '资料已更新');
  });

  // 修改密码（敏感操作）
  router.post('/api/user/password', async (req, res, body) => {
    const me = requireUser(req);
    const oldPwd = String(body.old_password || '');
    const newPwd = String(body.new_password || '');
    if (newPwd.length < 6) throw bad('新密码长度至少 6 位');
    const u = db.prepare('SELECT * FROM t_user WHERE user_id=?').get(me.sub);
    if (!verifyPassword(oldPwd, u.password)) throw bad('原密码不正确');
    db.prepare('UPDATE t_user SET password=? WHERE user_id=?').run(hashPassword(newPwd), me.sub);
    audit('user', me.sub, 'CHANGE_PASSWORD', '');
    return ok(res, null, '密码修改成功，请重新登录');
  });

  // 实名认证：提交后进入待复核状态（is_verified=2），管理员复核通过置 1
  router.post('/api/user/verify', async (req, res, body) => {
    const me = requireUser(req);
    const real_name = String(body.real_name || '').trim();
    const student_no = String(body.student_no || '').trim();
    if (real_name.length < 2) throw bad('请填写真实姓名');
    const u = db.prepare('SELECT * FROM t_user WHERE user_id=?').get(me.sub);
    if (u.is_verified === 1) throw bad('已完成实名认证，无需重复提交');
    if (student_no && student_no !== u.student_no) throw bad('校园卡学号与注册学号不一致');
    db.prepare('UPDATE t_user SET real_name=?, is_verified=2 WHERE user_id=?').run(real_name, me.sub);
    audit('user', me.sub, 'VERIFY_SUBMIT', real_name);
    return ok(res, null, '实名信息已提交，等待管理员复核');
  });

  // 卖家/买家主页
  router.get('/api/user/:id', async (req, res, body, params) => {
    const u = db.prepare('SELECT * FROM t_user WHERE user_id=?').get(Number(params.id));
    if (!u) throw notFound('用户不存在');
    const goods = db
      .prepare(
        'SELECT goods_id,title,category,price,quality,goods_status,images FROM t_goods WHERE seller_id=? AND audit_status=1 AND is_deleted=0 ORDER BY goods_id DESC'
      )
      .all(u.user_id)
      .map(normalizeGoodsRow);
    const reviews = db
      .prepare(
        `SELECT r.*, g.title AS goods_title, u2.nickname AS buyer_name, u2.avatar AS buyer_avatar
         FROM t_review r JOIN t_goods g ON r.goods_id=g.goods_id
         JOIN t_user u2 ON r.user_id=u2.user_id
         WHERE g.seller_id=? ORDER BY r.review_id DESC LIMIT 20`
      )
      .all(u.user_id);
    const avg = db
      .prepare(
        'SELECT IFNULL(ROUND(AVG(r.score),1),0) AS s, COUNT(*) AS c FROM t_review r JOIN t_goods g ON r.goods_id=g.goods_id WHERE g.seller_id=?'
      )
      .get(u.user_id);
    return ok(res, { user: publicUser(u), goods, reviews, rating: avg });
  });
}

export { publicUser };
