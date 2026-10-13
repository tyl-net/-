// 交易管理模块：下单 → 支付 → 发货 → 确认收货（结算）/ 取消
// 订单状态机：待支付(0) → 待发货(1) → 待收货(2) → 已完成(3)；任一环节取消进入 已取消(4)
import { db, audit, ORDER_STATUS } from '../db.js';
import { requireUser } from '../auth.js';
import { ok, bad, notFound, forbidden, parseUrl, genOrderNo, now } from '../util.js';

const ORDER_COLS = `o.*, g.title AS goods_title, g.images AS goods_images, g.category AS goods_category,
  ub.nickname AS buyer_name, us.nickname AS seller_name,
  (SELECT r.review_id FROM t_review r WHERE r.order_id=o.order_id) AS my_review_id,
  (SELECT COUNT(*) FROM t_review r WHERE r.order_id=o.order_id AND r.additional IS NOT NULL) AS additional_added`;

export function registerOrder(router) {
  // 创建订单（对商品下单）
  router.post('/api/order', async (req, res, body) => {
    const me = requireUser(req);
    const goods_id = Number(body.goods_id);
    if (!goods_id) throw bad('缺少商品ID');
    const g = db.prepare('SELECT * FROM t_goods WHERE goods_id=?').get(goods_id);
    if (!g || g.is_deleted === 1) throw notFound('商品不存在或已删除');
    if (g.audit_status !== 1) throw bad('该商品尚未通过审核，暂不可购买');
    if (g.goods_status !== 1) throw bad('该商品已下架或已售出');
    if (g.seller_id === me.sub) throw bad('不能购买自己发布的商品');

    const dup = db
      .prepare('SELECT order_id FROM t_order WHERE buyer_id=? AND goods_id=? AND order_status<4')
      .get(me.sub, goods_id);
    if (dup) throw bad('你已对该商品下过单，请前往「我的订单」继续处理');

    const no = genOrderNo();
    const t = now();
    const r = db
      .prepare(
        `INSERT INTO t_order(order_no,buyer_id,seller_id,goods_id,amount,order_status,created_at,updated_at)
         VALUES(?,?,?,?,?,0,?,?)`
      )
      .run(no, me.sub, g.seller_id, goods_id, g.price, t, t);
    audit('user', me.sub, 'ORDER_CREATE', `${no} 商品#${goods_id}`);
    return ok(res, { order_id: Number(r.lastInsertRowid), order_no: no }, '下单成功，请尽快完成支付');
  });

  // 在线支付（货款由平台托管）
  router.post('/api/order/pay', async (req, res, body) => {
    const me = requireUser(req);
    const o = mustOwn(req, body.order_id, 'buyer');
    if (o.order_status !== 0) throw bad(`订单当前状态为「${ORDER_STATUS[o.order_status]}」，无法支付`);
    const t = now();
    db.prepare('UPDATE t_order SET order_status=1, pay_time=?, updated_at=? WHERE order_id=?').run(t, t, o.order_id);
    audit('user', me.sub, 'ORDER_PAY', o.order_no);
    return ok(res, { order_status: 1 }, '支付成功，货款已由平台托管');
  });

  // 卖家发货
  router.put('/api/order/ship', async (req, res, body) => {
    const me = requireUser(req);
    const o = mustOwn(req, body.order_id, 'seller');
    if (o.order_status !== 1) throw bad(`订单当前状态为「${ORDER_STATUS[o.order_status]}」，无法发货`);
    db.prepare('UPDATE t_order SET order_status=2, updated_at=? WHERE order_id=?').run(now(), o.order_id);
    audit('user', me.sub, 'ORDER_SHIP', o.order_no);
    return ok(res, { order_status: 2 }, '已发货，等待买家确认收货');
  });

  // 确认收货并结算（托管货款结算给卖家）
  router.put('/api/order/confirm', async (req, res, body) => {
    const me = requireUser(req);
    const o = mustOwn(req, body.order_id, 'buyer');
    if (o.order_status !== 2) throw bad(`订单当前状态为「${ORDER_STATUS[o.order_status]}」，无法确认收货`);
    const t = now();
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE t_order SET order_status=3, finish_time=?, updated_at=? WHERE order_id=?').run(t, t, o.order_id);
      db.prepare('UPDATE t_goods SET goods_status=2 WHERE goods_id=?').run(o.goods_id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    // 结算：货款转入卖家（模拟入账，记入审计日志）
    audit('system', null, 'ORDER_SETTLE', `${o.order_no} 结算 ¥${o.amount} 至卖家#${o.seller_id}`);
    audit('user', me.sub, 'ORDER_CONFIRM', o.order_no);
    return ok(res, { order_status: 3 }, '确认收货成功，货款已结算给卖家');
  });

  // 取消订单（终态前买卖双方均可；必须填写取消原因，展示给对方并记入审计日志）
  router.put('/api/order/cancel', async (req, res, body) => {
    const me = requireUser(req);
    const o = requiresOrder(req, body.order_id);
    if (o.buyer_id !== me.sub && o.seller_id !== me.sub) throw forbidden('无权操作该订单');
    if (o.order_status >= 3) throw bad(`订单已是「${ORDER_STATUS[o.order_status]}」终态，无法取消`);
    const reason = String(body.reason || '').trim();
    if (!reason) throw bad('请填写取消原因，让对方知悉');
    if (reason.length > 200) throw bad('取消原因不能超过 200 字');
    const t = now();
    db.prepare('UPDATE t_order SET order_status=4, cancel_reason=?, cancel_by=?, updated_at=? WHERE order_id=?')
      .run(reason, me.sub, t, o.order_id);
    audit('user', me.sub, 'ORDER_CANCEL', `${o.order_no} 原因：${reason}`);
    return ok(res, { order_status: 4, cancel_reason: reason }, '订单已取消');
  });

  // 订单列表：role=buyer|seller，可按状态筛选
  router.get('/api/order', async (req, res) => {
    const me = requireUser(req);
    const url = parseUrl(req);
    const role = url.searchParams.get('role') === 'seller' ? 'seller' : 'buyer';
    const status = url.searchParams.get('status');
    const where = [role === 'seller' ? 'o.seller_id=?' : 'o.buyer_id=?'];
    const args = [me.sub];
    if (status !== null && status !== '') {
      where.push('o.order_status=?');
      args.push(Number(status));
    }
    const list = db
      .prepare(
        `SELECT ${ORDER_COLS},
           (SELECT COUNT(*) FROM t_review r WHERE r.order_id=o.order_id) AS reviewed
         FROM t_order o
         JOIN t_goods g ON o.goods_id=g.goods_id
         JOIN t_user ub ON o.buyer_id=ub.user_id
         JOIN t_user us ON o.seller_id=us.user_id
         WHERE ${where.join(' AND ')}
         ORDER BY o.order_id DESC`
      )
      .all(...args);
    return ok(res, { list, role });
  });

  // 订单详情
  router.get('/api/order/:id', async (req, res, body, params) => {
    const me = requireUser(req);
    const o = db
      .prepare(
        `SELECT ${ORDER_COLS} FROM t_order o JOIN t_goods g ON o.goods_id=g.goods_id
         JOIN t_user ub ON o.buyer_id=ub.user_id JOIN t_user us ON o.seller_id=us.user_id WHERE o.order_id=?`
      )
      .get(Number(params.id));
    if (!o) throw notFound('订单不存在');
    if (o.buyer_id !== me.sub && o.seller_id !== me.sub) throw forbidden('无权查看该订单');
    return ok(res, { order: o });
  });
}

function requiresOrder(req, orderId) {
  const me = requireUser(req);
  const o = db.prepare('SELECT * FROM t_order WHERE order_id=?').get(Number(orderId));
  if (!o) throw notFound('订单不存在');
  return o;
}

function mustOwn(req, orderId, role) {
  const me = requireUser(req);
  const o = requiresOrder(req, orderId);
  const owner = role === 'seller' ? o.seller_id : o.buyer_id;
  if (owner !== me.sub) throw forbidden(role === 'seller' ? '只有卖家可执行该操作' : '只有买家可执行该操作');
  return o;
}

export { ORDER_STATUS };
