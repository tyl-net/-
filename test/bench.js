// 接口性能实测：统计关键接口的响应耗时（取多次采样的平均值 / P95 / 最大值）
const B = process.env.BASE || 'http://127.0.0.1:3000';
const ROUNDS = Number(process.env.ROUNDS || 30);

async function login() {
  const r = await fetch(B + '/api/user/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_no: '241603010213', password: '123456' }),
  });
  const j = await r.json();
  return j.data.token;
}
const post = async (p, body) => {
  const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
};

const T = await login();
const A = (await post('/api/admin/login', { account: 'admin', password: '123456' })).data.token;
const H = (t) => ({ 'X-Auth-Token': t });

const cases = [
  ['商品浏览（分页）', '/api/goods?page=1&size=8', null, 200],
  ['商品搜索（关键词+价格区间）', '/api/goods/search?keyword=' + encodeURIComponent('教材') + '&minPrice=10&maxPrice=500', null, 200],
  ['商品详情（含评价）', '/api/goods/3', null, 200],
  ['我的商品列表', '/api/goods/mine', T, 200],
  ['我的订单（买家）', '/api/order?role=buyer', T, 200],
  ['评价中心', '/api/review/mine?role=written', T, 200],
  ['个人中心（含统计）', '/api/user/profile', T, 200],
  ['管理端数据看板', '/api/admin/stats', A, 200],
  ['管理端待审列表', '/api/admin/goods?audit_status=0&size=50', A, 200],
  ['管理端用户列表', '/api/admin/users', A, 200],
];

const stats = [];
for (const [name, path, token] of cases) {
  const times = [];
  for (let i = 0; i < ROUNDS; i++) {
    const t0 = performance.now();
    const r = await fetch(B + path, token ? { headers: H(token) } : {});
    await r.text();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const p95 = times[Math.floor(times.length * 0.95)] ?? times[times.length - 1];
  stats.push({ name, avg: +avg.toFixed(1), p95: +p95.toFixed(1), max: +times[times.length - 1].toFixed(1) });
}

// 写操作耗时：以「原值写回个人资料」为样本（真实 UPDATE，净效果为零，不留残留数据）
const me = (await (await fetch(B + '/api/user/profile', { headers: H(T) })).json()).data.user;
const writeTimes = [];
for (let i = 0; i < 20; i++) {
  const t0 = performance.now();
  await fetch(B + '/api/user/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...H(T) },
    body: JSON.stringify({ nickname: me.nickname, phone: me.phone, email: me.email }),
  });
  writeTimes.push(performance.now() - t0);
}
writeTimes.sort((a, b) => a - b);
const writeAvg = writeTimes.reduce((a, b) => a + b, 0) / writeTimes.length;

console.log('\n接口响应耗时实测（每项 ' + ROUNDS + ' 次采样，单位 ms）\n');
console.log('接口'.padEnd(30) + '平均'.padStart(8) + 'P95'.padStart(8) + '最大'.padStart(8));
console.log('-'.repeat(54));
for (const s of stats) {
  console.log(s.name.padEnd(30) + String(s.avg).padStart(8) + String(s.p95).padStart(8) + String(s.max).padStart(8));
}
console.log('\n写操作（UPDATE 个人资料，20 次采样）：平均 ' + writeAvg.toFixed(1) + ' ms，最大 ' + writeTimes[writeTimes.length - 1].toFixed(1) + ' ms');
const worst = Math.max(...stats.map((s) => s.p95));
console.log('\n全部只读接口 P95 最大值：' + worst.toFixed(1) + ' ms');
