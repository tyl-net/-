// 多通道鉴权容错测试：模拟「网关注入无效 Authorization」的真实部署场景
const B = process.env.BASE || 'http://127.0.0.1:3000';
const FAKE = 'Bearer eyJhbGciOiJIUzI1NiJ9.gateway-injected-not-mine.sig';

const login = await (await fetch(B + '/api/user/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ student_no: '241603010213', password: '123456' }),
})).json();
const T = login.data.token;

const cases = [
  ['无效 Authorization + 有效 X-Auth-Token', { Authorization: FAKE, 'X-Auth-Token': T }, 200],
  ['无效 Authorization + 有效 Cookie', { Authorization: FAKE, Cookie: 'cm_token=' + T }, 200],
  ['无效 Authorization + 有效 ?token=', { Authorization: FAKE }, 200, '?token=' + T],
  ['仅有效 Authorization', { Authorization: 'Bearer ' + T }, 200],
  ['仅无效 Authorization（应拒绝）', { Authorization: FAKE }, 401],
  ['无任何令牌（应拒绝）', {}, 401],
];

let pass = 0, fail = 0;
for (const [name, headers, expect, suffix] of cases) {
  const r = await fetch(B + '/api/goods/mine' + (suffix || ''), { headers });
  const ok = r.status === expect;
  console.log(`  ${ok ? '✅' : '❌'} ${name} → ${r.status}（期望 ${expect}）`);
  ok ? pass++ : fail++;
}
console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
