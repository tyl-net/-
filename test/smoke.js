// 全链路冒烟测试：覆盖五大模块主要接口
const B = process.env.BASE || 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const log = (t, ok, extra = '') => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${t}${extra ? '  → ' + extra : ''}`);
  ok ? pass++ : fail++;
};
async function api(method, path, { token, body } = {}) {
  const r = await fetch(B + path, {
    method,
    // 与产品前端一致走双通道：部署环境的网关会覆写 Authorization 头，
    // 只依赖单通道会在远程环境误报 401（本地不受影响）
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token, 'X-Auth-Token': token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json() };
}

const run = async () => {
  console.log('\n===== 校园二手交易平台 · 接口冒烟测试 =====\n');
  console.log('一、用户管理');
  const meta = await api('GET', '/api/meta');
  log('元数据（类别/成色/状态字典）', meta.json.code === 0 && meta.json.data.categories.length === 6);

  const noAuth = await api('GET', '/api/goods/mine');
  log('未登录访问受保护接口被拦截(401)', noAuth.status === 401, 'status=' + noAuth.status);

  const buyer = await api('POST', '/api/user/login', { body: { student_no: '241603010213', password: '123456' } });
  log('买家登录返回 JWT', buyer.json.code === 0 && !!buyer.json.data.token);
  const BT = buyer.json.data.token;

  const seller = await api('POST', '/api/user/login', { body: { student_no: '241603010301', password: '123456' } });
  const ST = seller.json.data.token;
  log('卖家登录', !!ST);

  const admin = await api('POST', '/api/admin/login', { body: { account: 'admin', password: '123456' } });
  const AT = admin.json.data.token;
  log('管理员登录', !!AT);

  const wrong = await api('POST', '/api/user/login', { body: { student_no: '241603010213', password: 'wrong' } });
  log('密码错误返回失败计数', wrong.json.code === 400 && /失败/.test(wrong.json.message), wrong.json.message);

  const reg = await api('POST', '/api/user/register', { body: { student_no: '241603019999', password: '123456', nickname: '冒烟测试员', phone: '13900001111' } });
  log('新用户注册', reg.json.code === 0 || /已注册/.test(reg.json.message), reg.json.message);

  const dupReg = await api('POST', '/api/user/register', { body: { student_no: '241603019999', password: '123456', nickname: '重复注册' } });
  log('学号唯一性校验', dupReg.status === 400, dupReg.json.message);

  console.log('\n二、商品管理');
  const pub = await api('POST', '/api/goods', { token: ST, body: { title: '冒烟测试-无线机械键盘', category: '电子数码', price: 88.5, quality: '九成新', description: '测试用商品，可删除' } });
  log('卖家发布商品（进入待审核）', pub.json.code === 0, pub.json.message || JSON.stringify(pub.json));
  const GID = pub.json.data.goods_id;

  const notVerified = await api('POST', '/api/goods', { token: (await api('POST', '/api/user/login', { body: { student_no: '241603010607', password: '123456' } })).json.data.token, body: { title: '未实名测试商品', category: '其他', price: 10, description: 'x' } });
  log('未实名用户禁止发布(403)', notVerified.status === 403, notVerified.json.message);

  const pending = await api('GET', '/api/admin/goods?audit_status=0', { token: AT });
  log('管理员查看待审列表', pending.json.code === 0 && pending.json.data.total >= 1, '待审 ' + pending.json.data.total + ' 件');

  const audit = await api('PUT', '/api/admin/goods/audit', { token: AT, body: { goods_id: GID, audit_status: 1, remark: '内容合规' } });
  log('管理员审核通过', audit.json.code === 0, audit.json.message);

  const searchKw = await api('GET', '/api/goods/search?keyword=' + encodeURIComponent('键盘'));
  log('关键词搜索', searchKw.json.data.total >= 1, '命中 ' + searchKw.json.data.total + ' 件');

  const searchPrice = await api('GET', '/api/goods/search?minPrice=100&maxPrice=500');
  log('价格区间检索', searchPrice.json.data.list.every((g) => g.price >= 100 && g.price <= 500), '命中 ' + searchPrice.json.data.total + ' 件');

  const searchCat = await api('GET', '/api/goods?category=' + encodeURIComponent('教材书籍'));
  log('类别筛选', searchCat.json.data.list.every((g) => g.category === '教材书籍'), '命中 ' + searchCat.json.data.total + ' 件');

  console.log('\n三、交易管理');
  const order = await api('POST', '/api/order', { token: BT, body: { goods_id: GID } });
  log('买家下单', order.json.code === 0, order.json.data && order.json.data.order_no);
  const OID = order.json.data.order_id;

  const dupOrder = await api('POST', '/api/order', { token: BT, body: { goods_id: GID } });
  log('重复下单拦截', dupOrder.status === 400, dupOrder.json.message);

  const pay = await api('POST', '/api/order/pay', { token: BT, body: { order_id: OID } });
  log('在线支付（货款托管）', pay.json.code === 0, pay.json.message);

  const earlyConfirm = await api('PUT', '/api/order/confirm', { token: BT, body: { order_id: OID } });
  log('状态机拦截（未发货不能确认收货）', earlyConfirm.status === 400, earlyConfirm.json.message);

  const ship = await api('PUT', '/api/order/ship', { token: ST, body: { order_id: OID } });
  log('卖家发货', ship.json.code === 0, ship.json.message);

  const confirm = await api('PUT', '/api/order/confirm', { token: BT, body: { order_id: OID } });
  log('确认收货并结算', confirm.json.code === 0, confirm.json.message);

  console.log('\n四、评价管理');
  const review = await api('POST', '/api/review', { token: BT, body: { order_id: OID, score: 5, content: '发货很快，键盘手感好！' } });
  log('发表评价', review.json.code === 0, review.json.message);

  const dupReview = await api('POST', '/api/review', { token: BT, body: { order_id: OID, score: 3, content: '再评一次' } });
  log('一单一评约束', dupReview.status === 400, dupReview.json.message);

  const received = await api('GET', '/api/review/mine?role=received', { token: ST });
  const RID = received.json.data.list[0].review_id;
  log('卖家查看收到的评价', received.json.data.list.length >= 1);

  const reply = await api('POST', `/api/review/${RID}/reply`, { token: ST, body: { reply: '感谢支持，欢迎再来！' } });
  log('卖家回复评价', reply.json.code === 0, reply.json.message);

  const goodsAfter = await api('GET', '/api/goods/' + GID);
  log('商品流转为已售出', goodsAfter.json.data.goods.goods_status === 2);
  log('商品详情展示评价与回复', goodsAfter.json.data.reviews[0] && !!goodsAfter.json.data.reviews[0].reply);

  const sellerProfile = await api('GET', '/api/user/2');
  log('卖家主页展示信用分与评价', sellerProfile.json.code === 0, '信用分 ' + sellerProfile.json.data.user.credit_score);

  console.log('\n五、系统管理');
  const stats = await api('GET', '/api/admin/stats', { token: AT });
  const s = stats.json.data.stats;
  log('运营数据统计', stats.json.code === 0, `用户${s.userTotal} 商品${s.goodsTotal} 订单${s.orderTotal} 成交额¥${s.gmv}`);

  const statsForbidden = await api('GET', '/api/admin/stats', { token: BT });
  log('普通用户禁用管理接口(403)', statsForbidden.status === 403);

  const users = await api('GET', '/api/admin/users?keyword=' + encodeURIComponent('谭'), { token: AT });
  log('用户查询', users.json.data.list.length >= 1, '命中 ' + users.json.data.list.length + ' 人');

  const dis = await api('PUT', '/api/admin/users/status', { token: AT, body: { user_id: 4, status: 0 } });
  log('禁用违规用户', dis.json.code === 0, dis.json.message);
  const loginDisabled = await api('POST', '/api/user/login', { body: { student_no: '241603010522', password: '123456' } });
  log('被禁用账号无法登录(403)', loginDisabled.status === 403, loginDisabled.json.message);
  await api('PUT', '/api/admin/users/status', { token: AT, body: { user_id: 4, status: 1 } });

  const ann = await api('POST', '/api/admin/announcements', { token: AT, body: { title: '冒烟测试公告', content: '这是接口测试发布的公告。' } });
  log('发布公告', ann.json.code === 0, ann.json.message);
  const annList = await api('GET', '/api/announcements');
  log('前台读取公告', annList.json.data.list.some((a) => a.title === '冒烟测试公告'));

  const reports = await api('GET', '/api/admin/reports', { token: AT });
  log('举报列表', reports.json.data.list.length >= 2);
  const handle = await api('PUT', '/api/admin/reports/handle', { token: AT, body: { id: 1, status: 1, remark: '举报成立，已下架' } });
  log('处理举报并联动处置', handle.json.code === 0, handle.json.message);

  const verifySubmit = await api('POST', '/api/user/verify', { token: (await api('POST', '/api/user/login', { body: { student_no: '241603010607', password: '123456' } })).json.data.token, body: { real_name: '赵一鸣' } });
  log('提交实名认证', verifySubmit.json.code === 0, verifySubmit.json.message);

  const logs = await api('GET', '/api/admin/logs', { token: AT });
  log('审计日志记录', logs.json.data.list.length > 0, logs.json.data.list.length + ' 条');

  console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====\n`);
  process.exit(fail ? 1 : 0);
};
run().catch((e) => {
  console.error('测试执行异常：', e);
  process.exit(1);
});
