// 系统管理模块（管理员）：商品审核、用户管理、公告、举报、数据统计、审计日志
import { db, audit, AUDIT_STATUS } from '../db.js';
import { hashPassword, verifyPassword, signToken, requireAdmin } from '../auth.js';
import { ok, bad, notFound, parseUrl, pager, now, normalizeGoodsRow } from '../util.js';

export function registerAdmin(router) {
  // 管理员登录
  router.post('/api/admin/login', async (req, res, body) => {
    const account = String(body.account || '').trim();
    const password = String(body.password || '');
    if (!account || !password) throw bad('请输入管理员账号与密码');
    const a = db.prepare('SELECT * FROM t_admin WHERE account=?').get(account);
    if (!a || !verifyPassword(password, a.password)) throw bad('管理员账号或密码错误');
    const token = signToken({ sub: a.admin_id, type: 'admin', name: a.name, role: a.role });
    audit('admin', a.admin_id, 'ADMIN_LOGIN', account);
    return ok(res, { token, admin: { admin_id: a.admin_id, account: a.account, name: a.name, role: a.role } }, '登录成功');
  });

  // 运营数据统计
  router.get('/api/admin/stats', async (req, res) => {
    requireAdmin(req);
    const one = (sql, ...a) => Number(db.prepare(sql).get(...a).v || 0);
    const stats = {
      userTotal: one('SELECT COUNT(*) AS v FROM t_user'),
      userActive: one('SELECT COUNT(*) AS v FROM t_user WHERE status=1'),
      userVerified: one('SELECT COUNT(*) AS v FROM t_user WHERE is_verified=1'),
      goodsTotal: one('SELECT COUNT(*) AS v FROM t_goods WHERE is_deleted=0'),
      goodsOnSale: one('SELECT COUNT(*) AS v FROM t_goods WHERE audit_status=1 AND goods_status=1 AND is_deleted=0'),
      goodsPending: one('SELECT COUNT(*) AS v FROM t_goods WHERE audit_status=0 AND is_deleted=0'),
      goodsSold: one('SELECT COUNT(*) AS v FROM t_goods WHERE goods_status=2 AND is_deleted=0'),
      orderTotal: one('SELECT COUNT(*) AS v FROM t_order'),
      orderDone: one('SELECT COUNT(*) AS v FROM t_order WHERE order_status=3'),
      orderPending: one('SELECT COUNT(*) AS v FROM t_order WHERE order_status IN (0,1,2)'),
      reportPending: one('SELECT COUNT(*) AS v FROM t_report WHERE status=0'),
      reviewTotal: one('SELECT COUNT(*) AS v FROM t_review'),
      gmv: Number(db.prepare('SELECT IFNULL(SUM(amount),0) AS v FROM t_order WHERE order_status=3').get().v),
      avgScore: Number(db.prepare('SELECT IFNULL(ROUND(AVG(score),2),0) AS v FROM t_review').get().v),
    };
    // 近 7 日成交趋势
    const trend = db
      .prepare(
        `SELECT substr(created_at,1,10) AS day, COUNT(*) AS orders, IFNULL(SUM(amount),0) AS amount
         FROM t_order WHERE created_at >= date('now','-6 day') GROUP BY day ORDER BY day`
      )
      .all();
    // 类别分布
    const byCategory = db
      .prepare('SELECT category, COUNT(*) AS c FROM t_goods WHERE audit_status=1 AND is_deleted=0 GROUP BY category ORDER BY c DESC')
      .all();
    return ok(res, { stats, trend, byCategory });
  });

  // 商品列表（默认待审核）
  router.get('/api/admin/goods', async (req, res) => {
    requireAdmin(req);
    const url = parseUrl(req);
    const { page, size, offset } = pager(url.searchParams);
    const auditStatus = url.searchParams.get('audit_status');
    const where = ['g.is_deleted=0'];
    const args = [];
    if (auditStatus !== null && auditStatus !== '') {
      where.push('g.audit_status=?');
      args.push(Number(auditStatus));
    }
    const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) AS c FROM t_goods g ${cond}`).get(...args).c;
    const list = db
      .prepare(
        `SELECT g.*, u.nickname AS seller_name, u.student_no AS seller_no, u.credit_score AS seller_credit
         FROM t_goods g JOIN t_user u ON g.seller_id=u.user_id ${cond}
         ORDER BY g.goods_id DESC LIMIT ? OFFSET ?`
      )
      .all(...args, size, offset);
    return ok(res, { list: list.map(normalizeGoodsRow), total: Number(total), page, size });
  });

  // 商品审核
  router.put('/api/admin/goods/audit', async (req, res, body) => {
    const me = requireAdmin(req);
    const goods_id = Number(body.goods_id);
    const audit_status = Number(body.audit_status);
    const remark = String(body.remark || '').trim();
    if (![1, 2].includes(audit_status)) throw bad('审核结果不合法（1 通过 / 2 驳回）');
    const g = db.prepare('SELECT * FROM t_goods WHERE goods_id=?').get(goods_id);
    if (!g) throw notFound('商品不存在');
    const goods_status = audit_status === 1 ? 1 : 0;
    db.prepare(
      'UPDATE t_goods SET audit_status=?, audit_remark=?, goods_status=?, audited_at=? WHERE goods_id=?'
    ).run(audit_status, remark || null, goods_status, now(), goods_id);
    audit('admin', me.sub, 'GOODS_AUDIT', `#${goods_id} ${AUDIT_STATUS[audit_status]} ${remark}`);
    return ok(res, null, `已${AUDIT_STATUS[audit_status]}`);
  });

  // 强制下架
  router.put('/api/admin/goods/offline', async (req, res, body) => {
    const me = requireAdmin(req);
    const g = db.prepare('SELECT * FROM t_goods WHERE goods_id=?').get(Number(body.goods_id));
    if (!g) throw notFound('商品不存在');
    db.prepare('UPDATE t_goods SET goods_status=0 WHERE goods_id=?').run(g.goods_id);
    audit('admin', me.sub, 'GOODS_OFFLINE', `#${g.goods_id}`);
    return ok(res, null, '商品已强制下架');
  });

  // 用户列表
  router.get('/api/admin/users', async (req, res) => {
    requireAdmin(req);
    const url = parseUrl(req);
    const kw = (url.searchParams.get('keyword') || '').trim();
    const where = [];
    const args = [];
    if (kw) {
      where.push('(student_no LIKE ? OR nickname LIKE ? OR phone LIKE ?)');
      args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
    }
    const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const list = db
      .prepare(
        `SELECT u.user_id,u.student_no,u.nickname,u.phone,u.credit_score,u.is_verified,u.status,u.created_at,
           (SELECT COUNT(*) FROM t_goods g WHERE g.seller_id=u.user_id) AS goods_count,
           (SELECT COUNT(*) FROM t_order o WHERE o.buyer_id=u.user_id) AS buy_count,
           (SELECT COUNT(*) FROM t_order o WHERE o.seller_id=u.user_id) AS sell_count
         FROM t_user u ${cond} ORDER BY u.user_id DESC`
      )
      .all(...args);
    return ok(res, { list });
  });

  // 禁用/启用用户
  router.put('/api/admin/users/status', async (req, res, body) => {
    const me = requireAdmin(req);
    const user_id = Number(body.user_id);
    const status = Number(body.status) === 0 ? 0 : 1;
    const u = db.prepare('SELECT * FROM t_user WHERE user_id=?').get(user_id);
    if (!u) throw notFound('用户不存在');
    db.prepare('UPDATE t_user SET status=? WHERE user_id=?').run(status, user_id);
    audit('admin', me.sub, status ? 'USER_ENABLE' : 'USER_DISABLE', `#${user_id} ${u.nickname}`);
    return ok(res, null, status ? '账号已启用' : '账号已禁用');
  });

  // 实名认证复核
  router.put('/api/admin/users/verify', async (req, res, body) => {
    const me = requireAdmin(req);
    const user_id = Number(body.user_id);
    const approve = body.approve !== false;
    const u = db.prepare('SELECT * FROM t_user WHERE user_id=?').get(user_id);
    if (!u) throw notFound('用户不存在');
    db.prepare('UPDATE t_user SET is_verified=? WHERE user_id=?').run(approve ? 1 : 0, user_id);
    audit('admin', me.sub, approve ? 'VERIFY_PASS' : 'VERIFY_REJECT', `#${user_id} ${u.nickname}`);
    return ok(res, null, approve ? '已通过实名认证' : '已驳回实名认证');
  });

  // 公告管理
  router.get('/api/admin/announcements', async (req, res) => {
    requireAdmin(req);
    const list = db.prepare('SELECT * FROM t_announcement ORDER BY id DESC').all();
    return ok(res, { list });
  });
  router.post('/api/admin/announcements', async (req, res, body) => {
    const me = requireAdmin(req);
    const title = String(body.title || '').trim();
    const content = String(body.content || '').trim();
    if (title.length < 2) throw bad('公告标题至少 2 个字');
    if (content.length < 2) throw bad('公告内容不能为空');
    const r = db.prepare('INSERT INTO t_announcement(title,content,status) VALUES(?,?,1)').run(title, content);
    audit('admin', me.sub, 'ANN_PUBLISH', title);
    return ok(res, { id: Number(r.lastInsertRowid) }, '公告已发布');
  });
  router.put('/api/admin/announcements/:id/status', async (req, res, body, params) => {
    const me = requireAdmin(req);
    const status = Number(body.status) === 0 ? 0 : 1;
    db.prepare('UPDATE t_announcement SET status=? WHERE id=?').run(status, Number(params.id));
    audit('admin', me.sub, status ? 'ANN_ON' : 'ANN_OFF', `#${params.id}`);
    return ok(res, null, status ? '公告已重新发布' : '公告已撤回');
  });
  router.delete('/api/admin/announcements/:id', async (req, res, body, params) => {
    requireAdmin(req);
    db.prepare('DELETE FROM t_announcement WHERE id=?').run(Number(params.id));
    return ok(res, null, '公告已删除');
  });

  // 举报处理
  router.get('/api/admin/reports', async (req, res) => {
    requireAdmin(req);
    const list = db
      .prepare(
        `SELECT rp.*, u.nickname AS reporter_name,
           CASE WHEN rp.target_type='goods' THEN (SELECT title FROM t_goods WHERE goods_id=rp.target_id)
                ELSE (SELECT nickname FROM t_user WHERE user_id=rp.target_id) END AS target_name
         FROM t_report rp JOIN t_user u ON rp.reporter_id=u.user_id
         ORDER BY rp.status ASC, rp.id DESC`
      )
      .all();
    return ok(res, { list });
  });
  router.put('/api/admin/reports/handle', async (req, res, body) => {
    const me = requireAdmin(req);
    const id = Number(body.id);
    const status = Number(body.status) === 1 ? 1 : 0;
    const remark = String(body.remark || '').trim();
    const rp = db.prepare('SELECT * FROM t_report WHERE id=?').get(id);
    if (!rp) throw notFound('举报记录不存在');
    db.prepare('UPDATE t_report SET status=?, handle_remark=? WHERE id=?').run(status, remark || null, id);
    // 举报成立时联动处置
    if (status === 1 && rp.target_type === 'goods') {
      db.prepare('UPDATE t_goods SET goods_status=0, audit_status=2 WHERE goods_id=?').run(rp.target_id);
    }
    if (status === 1 && rp.target_type === 'user') {
      db.prepare('UPDATE t_user SET status=0 WHERE user_id=?').run(rp.target_id);
    }
    audit('admin', me.sub, 'REPORT_HANDLE', `#${id} ${status ? '成立' : '驳回'} ${remark}`);
    return ok(res, null, status ? '举报已处理（已联动处置）' : '举报已驳回');
  });

  // 审计日志
  router.get('/api/admin/logs', async (req, res) => {
    requireAdmin(req);
    const list = db.prepare('SELECT * FROM t_audit_log ORDER BY id DESC LIMIT 100').all();
    return ok(res, { list });
  });
}
