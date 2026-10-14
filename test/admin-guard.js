// 回归测试：管理员误入学生功能不再被强制登出
// 背景：管理员令牌（type=admin）调用学生接口曾抛 401，前端把有效会话当"登录已过期"清空。
// 修复：后端区分 401（令牌无效）与 403（身份不符）；前端为学生专属路由加管理员守卫。
// 运行：node test/admin-guard.js  （需服务已启动）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:/Users/33465/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const PORT = 9362;
const SHOT_DIR = path.join(__dirname, '..', 'screenshots');
const profile = path.join(os.tmpdir(), 'cm-guard-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
};

// ---------- API 层 ----------
const login = async (p, b) => (await (await fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
})).json());

const adminLogin = await login('/api/admin/login', { account: 'admin', password: '123456' });
const userLogin = await login('/api/user/login', { student_no: '241603010213', password: '123456' });
const at = adminLogin.data?.token, ut = userLogin.data?.token;

console.log('\n============ 管理员越权防护回归 ============\n');
check('管理员登录成功', !!at);
check('学生登录成功', !!ut);

const call = (method, p, token, body) => fetch(BASE + p, {
  method, headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token || '' },
  body: body ? JSON.stringify(body) : undefined,
});

let r = await call('GET', '/api/user/profile', at);
check('管理员调学生接口 → 403（非 401）', r.status === 403, `status=${r.status}`);
let j = await r.json();
check('403 文案明确（不清会话）', /学生用户/.test(j.message || ''), j.message || '');

r = await call('POST', '/api/goods', at, { title: 'x', price: 1, description: 'xxxx', category: '教材书籍', quality: '全新' });
check('管理员发布商品 → 403', r.status === 403, `status=${r.status}`);

r = await call('GET', '/api/admin/stats', ut);
check('学生调管理接口 → 403（原行为不变）', r.status === 403, `status=${r.status}`);

r = await call('GET', '/api/user/profile', ut);
check('学生调自己资料 → 200（不受影响）', r.status === 200, `status=${r.status}`);

r = await call('GET', '/api/meta', '');
check('公开接口不要求登录 → 200', r.status === 200, `status=${r.status}`);

r = await call('GET', '/api/user/profile', 'fake-token-xxx');
check('无效令牌仍是 401（会话过期语义保留）', r.status === 401, `status=${r.status}`);

// ---------- 浏览器层 ----------
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

async function waitJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const res = await fetch(url); if (res.ok) return await res.json(); } catch {}
    await sleep(250);
  }
  throw new Error('Chrome 未就绪');
}
const list = await waitJson(`http://127.0.0.1:${PORT}/json/list`);
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('超时 ' + method)); } }, 20000);
});
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const shot = async (name) => {
  const d = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(d.data, 'base64'));
};

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(800);
  // v1.2 双会话：管理员身份存于本标签页的 sessionStorage
  await evaluate(`sessionStorage.setItem('cm_admin_token', ${JSON.stringify(at)});sessionStorage.setItem('cm_admin', ${JSON.stringify(JSON.stringify({ ...adminLogin.data.admin, type: 'admin' }))});'ok'`);

  // 直接复现原始路径：集市 → 发布闲置
  await send('Page.navigate', { url: BASE + '/#/home' });
  await sleep(1100);
  const home = await evaluate(`({
    publishBtn: !!([...document.querySelectorAll('button')].find(b => b.textContent.includes('发布闲置'))),
    adminBadge: !!([...document.querySelectorAll('.page-head .badge')].find(b => b.textContent.includes('管理员浏览模式'))),
  })`);
  check('集市页对管理员隐藏「＋发布闲置」', !home.publishBtn);
  check('集市页显示管理员浏览模式标识', home.adminBadge);

  // 原始 bug 路径：直接访问 #/publish
  await send('Page.navigate', { url: BASE + '/#/publish' });
  await sleep(1100);
  const pub = await evaluate(`({
    hash: location.hash,
    token: !!sessionStorage.getItem('cm_admin_token'),
    guard: (document.getElementById('app')||{}).innerText?.includes('该页面面向学生用户'),
    noVerifyBtn: ![...document.querySelectorAll('button')].find(b => b.textContent.trim() === '去认证'),
  })`);
  check('管理员访问发布页 → 显示说明页', pub.guard);
  check('不再出现「去认证」按钮', pub.noVerifyBtn);
  check('会话未被清除（token 仍在）', pub.token);
  check('停留在原路由而非跳登录页', pub.hash === '#/publish', pub.hash);
  await shot('regression-admin-guard.png');

  // 个人中心同样被守卫
  await send('Page.navigate', { url: BASE + '/#/profile' });
  await sleep(1100);
  const prof = await evaluate(`({
    token: !!sessionStorage.getItem('cm_admin_token'),
    guard: (document.getElementById('app')||{}).innerText?.includes('该页面面向学生用户'),
  })`);
  check('管理员访问个人中心 → 同样守卫', prof.guard);
  check('个人中心访问后会话仍有效', prof.token);

  const expired = await evaluate(`document.getElementById('toast-root')?.innerText || ''`);
  check('全程无「登录已过期」提示', !expired.includes('登录已过期'), expired.replace(/\n/g, ' ').slice(0, 40));
} catch (e) {
  console.error('浏览器环节失败:', e.message);
  fail++;
} finally {
  ws.close(); proc.kill();
}

console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====\n`);
process.exit(fail ? 1 : 0);
