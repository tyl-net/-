// 评价管理模块：发表评价、查看评价、卖家回复、信用分统计
import { db, audit } from '../db.js';
import { requireUser } from '../auth.js';
import { ok, bad, notFound, forbidden, parseUrl, now } from '../util.js';

// 信用分规则：以 3 分为中性，每高出 1 分 +4，每低 1 分 -4，范围 [0,150]
function creditDelta(score) {
  return (score - 3) * 4;
}

export function registerReview(router) {
  // 发表评价（仅订单完成后可评，一条订单限评一次）
  router.post('/api/review', async (req, res, body) => {
    const me = requireUser(req);
    const order_id = Number(body.order_id);
    const score = Number(body.score);
    const content = String(body.content || '').trim();
    if (!Number.isInteger(score) || score < 1 || score > 5) throw bad('评分必须为 1~5 的整数');
    if (content.length > 500) throw bad('评价内容不能超过 500 字');

    const o = db.prepare('SELECT * FROM t_order WHERE order_id=?').get(order_id);
    if (!o) throw notFound('订单不存在');
    if (o.buyer_id !== me.sub) throw forbidden('只有买家可以评价该订单');
    if (o.order_status !== 3) throw bad('订单尚未完成，暂不能评价');
    const dup = db.prepare('SELECT review_id FROM t_review WHERE order_id=?').get(order_id);
    if (dup) throw bad('该订单已评价，不能重复评价');

    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO t_review(order_id,user_id,goods_id,score,content) VALUES(?,?,?,?,?)').run(
        order_id,
        me.sub,
        o.goods_id,
        score,
        content
      );
      // 评分加权更新卖家信用分
      db.prepare(
        'UPDATE t_user SET credit_score=MIN(150, MAX(0, credit_score + ?)) WHERE user_id=?'
      ).run(creditDelta(score), o.seller_id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    audit('user', me.sub, 'REVIEW_CREATE', `订单#${order_id} ${score}分`);
    return ok(res, null, '评价发表成功，感谢你的反馈');
  });

  // 追加评价：评价发表后可补充一次使用感受（限作者本人、限一次，不影响原评分与信用分）
  router.put('/api/review/:id/additional', async (req, res, body, params) => {
    const me = requireUser(req);
    const content = String(body.content || '').trim();
    if (!content) throw bad('请填写追加评价内容');
    if (content.length > 500) throw bad('追加评价不能超过 500 字');
    const r = db.prepare('SELECT * FROM t_review WHERE review_id=?').get(Number(params.id));
    if (!r) throw notFound('评价不存在');
    if (r.user_id !== me.sub) throw forbidden('只有评价作者本人可以追加评价');
    if (r.additional) throw bad('该评价已追加过，仅可追加一次');
    db.prepare('UPDATE t_review SET additional=?, additional_at=? WHERE review_id=?').run(content, now(), r.review_id);
    audit('user', me.sub, 'REVIEW_ADDITIONAL', `评价#${r.review_id}`);
    return ok(res, null, '追加评价发表成功');
  });

  // 卖家回复评价
  router.post('/api/review/:id/reply', async (req, res, body, params) => {
    const me = requireUser(req);
    const reply = String(body.reply || '').trim();
    if (!reply) throw bad('请填写回复内容');
    if (reply.length > 500) throw bad('回复内容不能超过 500 字');
    const r = db
      .prepare(
        'SELECT r.*, g.seller_id FROM t_review r JOIN t_goods g ON r.goods_id=g.goods_id WHERE r.review_id=?'
      )
      .get(Number(params.id));
    if (!r) throw notFound('评价不存在');
    if (r.seller_id !== me.sub) throw forbidden('只有卖家可以回复该评价');
    db.prepare('UPDATE t_review SET reply=? WHERE review_id=?').run(reply, r.review_id);
    return ok(res, null, '回复成功');
  });

  // 我的评价：role=written 我发出的 / received 我收到的
  router.get('/api/review/mine', async (req, res) => {
    const me = requireUser(req);
    const url = parseUrl(req);
    const role = url.searchParams.get('role') === 'received' ? 'received' : 'written';
    const list =
      role === 'received'
        ? db
            .prepare(
              `SELECT r.*, g.title AS goods_title, g.images AS goods_images, g.category AS goods_category,
                      u.nickname AS buyer_name, u.avatar AS buyer_avatar
               FROM t_review r JOIN t_goods g ON r.goods_id=g.goods_id JOIN t_user u ON r.user_id=u.user_id
               WHERE g.seller_id=? ORDER BY r.review_id DESC`
            )
            .all(me.sub)
        : db
            .prepare(
              `SELECT r.*, g.title AS goods_title, g.images AS goods_images, g.category AS goods_category,
                      g.seller_id, us.nickname AS seller_name
               FROM t_review r JOIN t_goods g ON r.goods_id=g.goods_id JOIN t_user us ON g.seller_id=us.user_id
               WHERE r.user_id=? ORDER BY r.review_id DESC`
            )
            .all(me.sub);
    // 待评价订单数（已完成但未评价）
    const pending = db
      .prepare(
        `SELECT COUNT(*) AS c FROM t_order o WHERE o.buyer_id=? AND o.order_status=3
           AND NOT EXISTS(SELECT 1 FROM t_review r WHERE r.order_id=o.order_id)`
      )
      .get(me.sub).c;
    return ok(res, { list, role, pending: Number(pending) });
  });
}
