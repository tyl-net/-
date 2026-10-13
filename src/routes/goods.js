// 商品管理模块：发布、浏览、搜索、详情、我的商品、编辑、下架、删除
import { db, audit, CATEGORIES, AUDIT_STATUS } from '../db.js';
import { requireUser, currentUser } from '../auth.js';
import {
  ok, bad, notFound, forbidden, pager, parseUrl,
  serializeImages, parseImages, normalizeGoodsRow, MAX_IMAGES,
} from '../util.js';

function validateGoods(body) {
  const title = String(body.title || '').trim();
  const category = String(body.category || '').trim();
  const price = Number(body.price);
  const quality = String(body.quality || '').trim();
  const description = String(body.description || '').trim();
  if (title.length < 2 || title.length > 60) throw bad('商品名称长度应为 2~60 个字符');
  if (!CATEGORIES.includes(category)) throw bad('请选择合法的商品类别');
  if (!Number.isFinite(price) || price <= 0 || price > 999999) throw bad('请填写合法价格（大于 0）');
  if (description.length > 1000) throw bad('商品描述不能超过 1000 字');
  return { title, category, price: Math.round(price * 100) / 100, quality, description };
}

const GOODS_COLS = `g.*, u.nickname AS seller_name, u.credit_score AS seller_credit, u.is_verified AS seller_verified`;
const NOT_DELETED = 'g.is_deleted=0';

/** 取商品并校验归属；deletedOk=false 时已删除商品按不存在处理 */
function ownGoods(req, id, { allowSold = false, deletedOk = false } = {}) {
  const me = requireUser(req);
  const g = db.prepare('SELECT * FROM t_goods WHERE goods_id=?').get(Number(id));
  if (!g || (!deletedOk && g.is_deleted === 1)) throw notFound('商品不存在');
  if (g.seller_id !== me.sub) throw forbidden('只能操作自己发布的商品');
  if (!allowSold && g.goods_status === 2) throw bad('商品已售出，无法执行该操作');
  return { me, g };
}

export function registerGoods(router) {
  // 商品发布（需实名认证）
  router.post('/api/goods', async (req, res, body) => {
    const me = requireUser(req);
    const u = db.prepare('SELECT * FROM t_user WHERE user_id=?').get(me.sub);
    if (u.is_verified !== 1) throw forbidden('请先完成实名认证后再发布商品');
    const g = validateGoods(body);
    const images = serializeImages(body.images);
    const r = db
      .prepare(
        `INSERT INTO t_goods(seller_id,title,category,price,quality,description,images,audit_status,goods_status,is_deleted)
         VALUES(?,?,?,?,?,?,?,0,1,0)`
      )
      .run(u.user_id, g.title, g.category, g.price, g.quality, g.description, images);
    audit('user', u.user_id, 'GOODS_PUBLISH', `#${r.lastInsertRowid} ${g.title}`);
    return ok(res, { goods_id: Number(r.lastInsertRowid) }, '发布成功，等待管理员审核');
  });

  // 商品浏览：按发布时间倒序分页，支持类别筛选
  router.get('/api/goods', async (req, res) => {
    const url = parseUrl(req);
    const { page, size, offset } = pager(url.searchParams);
    const category = url.searchParams.get('category') || '';
    const where = ['g.audit_status=1', 'g.goods_status=1', NOT_DELETED];
    const args = [];
    if (category && CATEGORIES.includes(category)) {
      where.push('g.category=?');
      args.push(category);
    }
    const cond = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS c FROM t_goods g WHERE ${cond}`).get(...args).c;
    const rows = db
      .prepare(
        `SELECT ${GOODS_COLS} FROM t_goods g JOIN t_user u ON g.seller_id=u.user_id
         WHERE ${cond} ORDER BY g.created_at DESC, g.goods_id DESC LIMIT ? OFFSET ?`
      )
      .all(...args, size, offset);
    return ok(res, { list: rows.map(normalizeGoodsRow), total: Number(total), page, size });
  });

  // 商品搜索：关键词 + 类别 + 价格区间组合检索
  router.get('/api/goods/search', async (req, res) => {
    const url = parseUrl(req);
    const { page, size, offset } = pager(url.searchParams);
    const kw = (url.searchParams.get('keyword') || '').trim();
    const category = url.searchParams.get('category') || '';
    const minPrice = parseFloat(url.searchParams.get('minPrice'));
    const maxPrice = parseFloat(url.searchParams.get('maxPrice'));

    const where = ['g.audit_status=1', 'g.goods_status=1', NOT_DELETED];
    const args = [];
    if (kw) {
      where.push('(g.title LIKE ? OR g.description LIKE ?)');
      args.push(`%${kw}%`, `%${kw}%`);
    }
    if (category && CATEGORIES.includes(category)) {
      where.push('g.category=?');
      args.push(category);
    }
    if (Number.isFinite(minPrice)) {
      where.push('g.price>=?');
      args.push(minPrice);
    }
    if (Number.isFinite(maxPrice)) {
      where.push('g.price<=?');
      args.push(maxPrice);
    }
    const cond = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS c FROM t_goods g WHERE ${cond}`).get(...args).c;
    const rows = db
      .prepare(
        `SELECT ${GOODS_COLS} FROM t_goods g JOIN t_user u ON g.seller_id=u.user_id
         WHERE ${cond} ORDER BY g.created_at DESC, g.goods_id DESC LIMIT ? OFFSET ?`
      )
      .all(...args, size, offset);
    return ok(res, { list: rows.map(normalizeGoodsRow), total: Number(total), page, size, keyword: kw });
  });

  // 我发布的商品
  router.get('/api/goods/mine', async (req, res) => {
    const me = requireUser(req);
    const url = parseUrl(req);
    const auditStatus = url.searchParams.get('audit_status');
    let sql = `SELECT g.*, (SELECT COUNT(*) FROM t_order o WHERE o.goods_id=g.goods_id AND o.order_status<4) AS active_orders,
                      (SELECT COUNT(*) FROM t_order o WHERE o.goods_id=g.goods_id) AS total_orders
               FROM t_goods g WHERE g.seller_id=? AND ${NOT_DELETED}`;
    const args = [me.sub];
    if (auditStatus !== null && auditStatus !== '') {
      sql += ' AND g.audit_status=?';
      args.push(Number(auditStatus));
    }
    sql += ' ORDER BY g.goods_id DESC';
    const list = db.prepare(sql).all(...args);
    return ok(res, { list: list.map(normalizeGoodsRow) });
  });

  // 商品详情（浏览量 +1）
  router.get('/api/goods/:id', async (req, res, body, params) => {
    const id = Number(params.id);
    const g = db
      .prepare(`SELECT ${GOODS_COLS} FROM t_goods g JOIN t_user u ON g.seller_id=u.user_id WHERE g.goods_id=? AND ${NOT_DELETED}`)
      .get(id);
    if (!g) throw notFound('商品不存在或已删除');
    const me = currentUser(req);
    if (me && me.type === 'user' && me.sub !== g.seller_id) {
      db.prepare('UPDATE t_goods SET view_count=view_count+1 WHERE goods_id=?').run(id);
      g.view_count = Number(g.view_count) + 1;
    }
    const reviews = db
      .prepare(
        `SELECT r.*, u2.nickname AS buyer_name, u2.avatar AS buyer_avatar
         FROM t_review r JOIN t_user u2 ON r.user_id=u2.user_id
         WHERE r.goods_id=? ORDER BY r.review_id DESC`
      )
      .all(id);
    return ok(res, { goods: normalizeGoodsRow(g), reviews });
  });

  // 编辑商品（可替换图片，重新进入待审核）
  router.put('/api/goods/:id', async (req, res, body, params) => {
    const { g: g0 } = ownGoods(req, params.id);
    const g = validateGoods(body);
    // 未传 images 字段 → 保留原图；传了（含空数组）→ 以传入为准
    const images = body.images === undefined
      ? (g0.images || '[]')
      : serializeImages(body.images);
    db.prepare(
      `UPDATE t_goods SET title=?,category=?,price=?,quality=?,description=?,images=?,audit_status=0,audit_remark=NULL,audited_at=NULL WHERE goods_id=?`
    ).run(g.title, g.category, g.price, g.quality, g.description, images, g0.goods_id);
    return ok(res, null, '修改成功，已重新提交审核');
  });

  // 删除商品（软删除：保留交易记录引用，商品从各列表与集市中移除）
  router.delete('/api/goods/:id', async (req, res, body, params) => {
    const { me, g } = ownGoods(req, params.id, { allowSold: true });
    const active = db
      .prepare('SELECT COUNT(*) AS c FROM t_order WHERE goods_id=? AND order_status<4')
      .get(g.goods_id).c;
    if (Number(active) > 0) {
      throw bad(`该商品还有 ${active} 笔进行中的订单，请先完成或取消订单后再删除`);
    }
    db.prepare('UPDATE t_goods SET is_deleted=1, goods_status=0 WHERE goods_id=?').run(g.goods_id);
    audit('user', me.sub, 'GOODS_DELETE', `#${g.goods_id} ${g.title}`);
    return ok(res, null, '商品已删除');
  });

  // 下架商品
  router.put('/api/goods/:id/offline', async (req, res, body, params) => {
    const { g } = ownGoods(req, params.id);
    db.prepare('UPDATE t_goods SET goods_status=0 WHERE goods_id=?').run(g.goods_id);
    return ok(res, null, '商品已下架');
  });

  // 重新上架
  router.put('/api/goods/:id/online', async (req, res, body, params) => {
    const { g } = ownGoods(req, params.id);
    db.prepare('UPDATE t_goods SET goods_status=1 WHERE goods_id=?').run(g.goods_id);
    return ok(res, null, '商品已重新上架');
  });

  // 商品评价列表
  router.get('/api/goods/:id/reviews', async (req, res, body, params) => {
    const list = db
      .prepare(
        `SELECT r.*, u.nickname AS buyer_name FROM t_review r JOIN t_user u ON r.user_id=u.user_id
         WHERE r.goods_id=? ORDER BY r.review_id DESC`
      )
      .all(Number(params.id));
    return ok(res, { list });
  });

  // 举报商品/用户
  router.post('/api/report', async (req, res, body) => {
    const me = requireUser(req);
    const target_type = body.target_type === 'user' ? 'user' : 'goods';
    const target_id = Number(body.target_id);
    const reason = String(body.reason || '').trim();
    if (!target_id) throw bad('举报对象不合法');
    if (reason.length < 4) throw bad('请填写至少 4 个字的举报原因');
    db.prepare('INSERT INTO t_report(reporter_id,target_type,target_id,reason) VALUES(?,?,?,?)').run(
      me.sub,
      target_type,
      target_id,
      reason
    );
    audit('user', me.sub, 'REPORT', `${target_type}#${target_id}`);
    return ok(res, null, '举报已提交，管理员将尽快处理');
  });
}

export { AUDIT_STATUS, parseImages, MAX_IMAGES };
