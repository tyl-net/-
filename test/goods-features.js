// 商品图片上传 / 编辑图片 / 删除商品 功能测试
const B = process.env.BASE || 'http://127.0.0.1:3000';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG2 = PNG.replace('iVBORw0KGgo', 'iVBORw0KGgo');

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { console.log(`  ${ok ? '✅' : '❌'} ${n}${extra ? '  → ' + extra : ''}`); ok ? pass++ : fail++; };

const api = async (method, path, { token, body } = {}) => {
  const r = await fetch(B + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Auth-Token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
};
const login = async (no) => (await api('POST', '/api/user/login', { body: { student_no: no, password: '123456' } })).json.data.token;

console.log('\n===== 商品图片 / 删除 功能测试 =====\n');

const ST = await login('241603010213');   // 谭以勒：卖家，种子商品 5 有进行中订单
const OT = await login('241603010301');   // 李思远：另一个卖家，用于越权测试

console.log('一、发布时上传图片');
const pub = await api('POST', '/api/goods', {
  token: ST,
  body: { title: '图片上传测试-马克杯', category: '生活用品', price: 26.5, quality: '全新', description: '用于验证图片上传功能', images: [PNG, PNG2] },
});
check('发布带 2 张图片的商品', pub.json.code === 0, pub.json.message);
const GID = pub.json.data.goods_id;

const mine = await api('GET', '/api/goods/mine', { token: ST });
const row = mine.json.data.list.find((g) => g.goods_id === GID);
check('我的商品中 images 为数组且含 2 张', Array.isArray(row.images) && row.images.length === 2, `长度 ${row.images.length}`);
check('图片为 data URI', row.images[0].startsWith('data:image/png;base64,'));

const detail = await api('GET', '/api/goods/' + GID);
check('详情接口返回 images 数组', Array.isArray(detail.json.data.goods.images) && detail.json.data.goods.images.length === 2);

console.log('\n二、图片校验');
const tooMany = await api('POST', '/api/goods', { token: ST, body: { title: '四图测试', category: '其他', price: 1, description: 'x', images: [PNG, PNG2, PNG, PNG] } });
check('超过 3 张被拒绝', tooMany.status === 400, tooMany.json.message);
const badFmt = await api('POST', '/api/goods', { token: ST, body: { title: '格式测试', category: '其他', price: 1, description: 'x', images: ['data:application/pdf;base64,AAAA'] } });
check('非法图片格式被拒绝', badFmt.status === 400, badFmt.json.message);
const urlOk = await api('POST', '/api/goods', { token: ST, body: { title: 'URL图片测试', category: '其他', price: 1, description: 'x', images: ['https://example.com/a.jpg'] } });
check('http(s) 图片地址仍被接受', urlOk.json.code === 0);
const urlGid = urlOk.json.data.goods_id;

console.log('\n三、编辑商品替换图片');
const edit1 = await api('PUT', '/api/goods/' + GID, { token: ST, body: { title: '图片上传测试-马克杯', category: '生活用品', price: 26.5, quality: '全新', description: '换一张图', images: [PNG2] } });
check('编辑时替换图片成功', edit1.json.code === 0, edit1.json.message);
const after1 = (await api('GET', '/api/goods/' + GID)).json.data.goods;
check('图片数量变为 1', after1.images.length === 1);

const edit2 = await api('PUT', '/api/goods/' + GID, { token: ST, body: { title: '图片上传测试-马克杯', category: '生活用品', price: 26.5, quality: '全新', description: '不改图片' } });
check('编辑时不传 images 保留原图', edit2.json.code === 0 && (await api('GET', '/api/goods/' + GID)).json.data.goods.images.length === 1);

const edit3 = await api('PUT', '/api/goods/' + GID, { token: ST, body: { title: '图片上传测试-马克杯', category: '生活用品', price: 26.5, quality: '全新', description: '清空图片', images: [] } });
const after3 = (await api('GET', '/api/goods/' + GID)).json.data.goods;
check('编辑时传空数组可清空图片', edit3.json.code === 0 && after3.images.length === 0);

console.log('\n四、删除商品');
const crossDel = await api('DELETE', '/api/goods/' + GID, { token: OT });
check('越权删除被拒(403)', crossDel.status === 403, crossDel.json.message);

const activeDel = await api('DELETE', '/api/goods/5', { token: ST });   // 商品5 有进行中订单
check('有进行中订单时拒绝删除', activeDel.status === 400, activeDel.json.message);

const del = await api('DELETE', '/api/goods/' + GID, { token: ST });
check('删除自己的商品成功', del.json.code === 0, del.json.message);

const mineAfter = await api('GET', '/api/goods/mine', { token: ST });
check('删除后不再出现在「我的商品」', !mineAfter.json.data.list.some((g) => g.goods_id === GID));
const detailAfter = await api('GET', '/api/goods/' + GID);
check('删除后详情返回 404', detailAfter.status === 404, detailAfter.json.message);
const delAgain = await api('DELETE', '/api/goods/' + GID, { token: ST });
check('重复删除返回 404', delAgain.status === 404, delAgain.json.message);

await api('DELETE', '/api/goods/' + urlGid, { token: ST });

console.log('\n五、删除对统计与集市的影响');
const stats = await api('GET', '/api/admin/stats', { token: (await api('POST', '/api/admin/login', { body: { account: 'admin', password: '123456' } })).json.data.token });
check('管理端统计正常返回', stats.json.code === 0, `商品总数 ${stats.json.data.stats.goodsTotal}`);
const search = await api('GET', '/api/goods/search?keyword=' + encodeURIComponent('马克杯'));
check('已删除商品不出现在集市搜索', search.json.data.total === 0);

console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====\n`);
process.exit(fail ? 1 : 0);
