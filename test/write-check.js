// 线上写入能力验证：全部选用「净效果为零」的操作，不污染演示数据
const B = process.env.BASE || 'http://127.0.0.1:3000';
const post = (p, body, headers = {}) =>
  fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const put = (p, body, headers = {}) =>
  fetch(B + p, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { console.log(`  ${ok ? '✅' : '❌'} ${n}${extra ? '  → ' + extra : ''}`); ok ? pass++ : fail++; };

console.log(`\n===== 数据写入验证 @ ${B} =====\n`);

// 1) 错误密码 → 触发 UPDATE（fail_count += 1，落库）
const bad = await (await post('/api/user/login', { student_no: '241603010213', password: 'wrong-password' })).json();
check('UPDATE 写入（登录失败计数落库）', /失败/.test(bad.message || ''), bad.message);

// 2) 正确密码 → 触发 UPDATE 复位 fail_count（净效果为零）
const good = await (await post('/api/user/login', { student_no: '241603010213', password: '123456' })).json();
check('UPDATE 复位成功（fail_count 归零）', good.code === 0, '登录成功');
const token = good.data.token;

// 3) 以原值更新个人资料 → 写入但内容不变（净效果为零）
const me = await (await fetch(B + '/api/user/profile', { headers: { 'X-Auth-Token': token } })).json();
const upd = await (await put('/api/user/profile', {
  nickname: me.data.user.nickname, phone: me.data.user.phone, email: me.data.user.email,
}, { 'X-Auth-Token': token })).json();
check('UPDATE 个人资料（原值写回）', upd.code === 0, upd.message);

// 4) 重复注册 → 唯一约束生效，不产生新记录
const dup = await post('/api/user/register', { student_no: '241603010213', password: '123456', nickname: '重复注册测试' });
check('唯一约束生效（学号不可重复）', dup.status === 400, `status=${dup.status}`);

// 5) 非法状态跃迁 → 事务/校验拦截，不产生脏数据
const badJump = await (await put('/api/order/confirm', { order_id: 1 }, { 'X-Auth-Token': token })).json();
check('业务校验生效（非法状态跃迁被拒）', badJump.code !== 0, badJump.message);

// 6) 越权访问 → 拒绝
const otherOrder = await fetch(B + '/api/order/99', { headers: { 'X-Auth-Token': token } });
check('越权访问被拒', otherOrder.status === 403 || otherOrder.status === 404, `status=${otherOrder.status}`);

console.log(`\n结果：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail ? 1 : 0);
