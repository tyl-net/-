// 补充截图：编辑商品弹窗（含商品图片字段与选择器）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:/Users/33465/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const PORT = 9334;
const SHOT_DIR = path.join(__dirname, '..', 'screenshots');
const profile = path.join(os.tmpdir(), 'cm-shot-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore' });

async function waitJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
    await sleep(250);
  }
  throw new Error('Chrome 未就绪');
}

const list = await waitJson(`http://127.0.0.1:${PORT}/json/version`) && await waitJson(`http://127.0.0.1:${PORT}/json/list`);
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
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('超时 ' + method)); } }, 15000);
});
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const login = await (await fetch(BASE + '/api/user/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_no: '241603010213', password: '123456' }),
  })).json();
  const user = JSON.stringify({ ...login.data.user, type: 'user' });

  // 先落到同源页面写入会话，再导航到目标路由（顺序反了会被 app 重定向到首页）
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(900);
  await evaluate(`localStorage.setItem('cm_token', ${JSON.stringify(login.data.token)});localStorage.setItem('cm_user', ${JSON.stringify(user)});'ok'`);
  await send('Page.navigate', { url: BASE + '/#/my-goods' });
  await sleep(600);

  // 等待「我的商品」列表渲染完成（轮询，远端/冷启动可能较慢）
  let ready = false;
  for (let i = 0; i < 60; i++) {
    ready = await evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '编辑')`);
    if (ready) break;
    await sleep(300);
  }
  console.log('列表就绪:', ready);
  if (!ready) {
    const diag = await evaluate(`(() => ({
      hash: location.hash,
      appText: (document.getElementById('app')?.innerText || '').slice(0, 200),
      buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).slice(0, 20),
      hasToken: !!localStorage.getItem('cm_token'),
    }))()`);
    console.log('诊断:', JSON.stringify(diag, null, 2));
  }

  // 点击第一行的「编辑」
  const clicked = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '编辑');
    if (!btns.length) return 'no-edit-button';
    btns[0].click();
    return 'clicked';
  })()`);
  await sleep(1200);
  const modalInfo = await evaluate(`(() => {
    const m = document.querySelector('.modal');
    if (!m) return { ok: false };
    const imgs = m.querySelectorAll('.img-cell, .img-add, input[type=file]');
    return {
      ok: true,
      title: m.querySelector('h3')?.textContent || '',
      fields: [...m.querySelectorAll('.field-label')].map(e => e.textContent.trim()),
      imageControls: imgs.length,
      uploadHint: [...m.querySelectorAll('.field-hint')].map(e => e.textContent.trim()).find(t => t.includes('图片')) || '',
    };
  })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, '16-编辑商品-含图片.png'), Buffer.from(data, 'base64'));

  console.log('点击「编辑」:', clicked);
  console.log('弹窗标题:', modalInfo.title);
  console.log('字段列表:', (modalInfo.fields || []).join(' / '));
  console.log('图片相关控件数:', modalInfo.imageControls);
  console.log('图片提示:', modalInfo.uploadHint);
  console.log('截图: screenshots/16-编辑商品-含图片.png');
  console.log(modalInfo.ok && modalInfo.fields?.some(f => f.includes('图片')) && modalInfo.imageControls > 0
    ? '\n结论：编辑弹窗确实包含「商品图片」字段与图片选择器 ✅'
    : '\n结论：编辑弹窗缺少图片字段 ❌');
} finally {
  try { ws.close(); } catch {}
  proc.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(0);
