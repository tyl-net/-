// 设计规范站截图（Chrome DevTools Protocol，避免 agent-browser daemon 挂起）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:/Users/33465/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const PORT = 9341;
const SHOT_DIR = path.join(__dirname, '..', 'screenshots');
const profile = path.join(os.tmpdir(), 'cm-ds-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(SHOT_DIR, { recursive: true });
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore' });

async function waitJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
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
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
});

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: BASE + '/design-system/' });
  await sleep(1800);

  const shot = async (name, opts = {}) => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, ...opts });
    const f = path.join(SHOT_DIR, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log('  ✔ ' + name);
  };

  // 分屏截图：按区块裁剪（clip 使用页面坐标，避免整页缩放失真）
  const sections = ['overview', 'color', 'typography', 'spacing', 'radius', 'elevation', 'motion', 'components', 'a11y', 'responsive', 'tokens'];
  for (const s of sections) {
    const box = await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(s)});if(!e)return null;const r=e.getBoundingClientRect();return {y:Math.round(r.top+window.scrollY),h:Math.round(r.height)};})()`);
    if (!box) { console.log('  ✕ 未找到 ' + s); continue; }
    const hh = Math.min(2500, Math.max(200, box.h));
    await shot(`ds-${s}.png`, { clip: { x: 0, y: box.y, width: 1440, height: hh, scale: 1 } });
  }

  // 移动端
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: BASE + '/design-system/' });
  await sleep(1500);
  await shot('ds-mobile.png', { clip: { x: 0, y: 0, width: 390, height: 1600, scale: 1 } });
  const mob = await evaluate(`(()=>{const d=document.documentElement;return {scrollW:d.scrollWidth,clientW:d.clientWidth,overflow:d.scrollWidth-d.clientWidth};})()`);
  console.log('  移动端宽度:', JSON.stringify(mob));

  const summary = await evaluate(`(()=>{
    const q=(s)=>document.querySelectorAll(s).length;
    return {
      swatches:q('.swatch'), semantic:q('.semantic-card'), typeRows:q('.type-row'),
      spacing:q('#spacing-list .scale-item'), radius:q('.radius-item'), shadows:q('#shadow-grid .shadow-item'),
      contrastRows:q('#contrast-table tbody tr'), tokenRows:q('#token-table tbody tr'),
      stats:q('.stat'), badge:document.getElementById('badge-tokens').textContent,
      a11y:document.getElementById('badge-a11y').textContent,
      calc:document.getElementById('calc-score').textContent,
      overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };})()`);
  console.log('\n渲染统计:', JSON.stringify(summary, null, 1));
  if (errors.length) { console.log('\n❌ 页面错误:'); errors.slice(0, 10).forEach((e) => console.log('   ' + e)); }
  else console.log('\n✅ 无页面 JS 错误');
} catch (e) {
  console.error('截图失败:', e.message);
  process.exitCode = 1;
} finally {
  ws.close(); proc.kill();
}
