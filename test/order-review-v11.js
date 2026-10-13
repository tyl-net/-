// 回归测试 v1.1：取消订单必填原因 + 追加评价（限一次）
// 自包含：自己发布/审核/下单，可重复运行（每次生成新商品，不依赖库内既有数据）
// 运行：node test/order-review-v11.js  （需服务已启动；BASE 可指定远程）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const CHROME = 'C:/Users/33465/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe';
const PORT = 9363;
const SHOT_DIR = path.join(__dirname, '..', 'screenshots');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
};
const api = async (method, p, token, body) => {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Auth-Token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json() };
};

console.log('\n============ v1.1 回归：取消原因 + 追加评价 ============\n');

// ---------- 准备：登录 + 发商品 + 审核 ----------
const buyer = await api('POST', '/api/user/login', null, { student_no: '241603010213', password: '123456' });
const seller = await api('POST', '/api/user/login', null, { student_no: '241603010301', password: '123456' });
const admin = await api('POST', '/api/admin/login', null, { account: 'admin', password: '123456' });
const BT = buyer.json.data.token, ST = seller.json.data.token, AT = admin.json.data.token;
check('三个角色登录', !!BT && !!ST && !!AT);

const pub = await api('POST', '/api/goods', ST, {
  title: '回归测试-追加评价用 帆布包', category: '生活用品', price: 9.9, quality: '九成新',
  description: 'v1.1 回归测试专用商品，测试后可删除。',
});
check('卖家发布测试商品', pub.json.code === 0, pub.json.message);
const NG = pub.json.data.goods_id;
await api('PUT', '/api/admin/goods/audit', AT, { goods_id: NG, audit_status: 1, remark: '回归测试' });

// ---------- 一、取消订单必填原因 ----------
console.log('\n一、取消订单');
const o1 = await api('POST', '/api/order', BT, { goods_id: NG });
const CID = o1.json.data.order_id;
check('买家下单', o1.json.code === 0, o1.json.data.order_no);

const noReason = await api('PUT', '/api/order/cancel', BT, { order_id: CID });
check('不填原因取消被拦截(400)', noReason.status === 400, noReason.json.message);
const blankReason = await api('PUT', '/api/order/cancel', BT, { order_id: CID, reason: '    ' });
check('纯空格原因同样拦截(400)', blankReason.status === 400, blankReason.json.message);
const longReason = await api('PUT', '/api/order/cancel', BT, { order_id: CID, reason: '超'.repeat(201) });
check('超 200 字原因拦截(400)', longReason.status === 400, longReason.json.message);

const cancelled = await api('PUT', '/api/order/cancel', BT, { order_id: CID, reason: '拍错了颜色，重新下单' });
check('填写原因后取消成功', cancelled.json.code === 0, cancelled.json.message);

const detail = await api('GET', '/api/order/' + CID, BT);
check('订单详情记录取消原因', detail.json.data.order.cancel_reason === '拍错了颜色，重新下单');
check('订单详情记录取消人是买家', detail.json.data.order.cancel_by === buyer.json.data.user.user_id);

const again = await api('PUT', '/api/order/cancel', BT, { order_id: CID, reason: '再取消一次' });
check('已取消订单不可再取消(400)', again.status === 400, again.json.message);

// ---------- 二、追加评价 ----------
console.log('\n二、追加评价');
const o2 = await api('POST', '/api/order', BT, { goods_id: NG });
const RID_ORDER = o2.json.data.order_id;
check('已取消订单不占名额，可再次下单', o2.json.code === 0, o2.json.message);
await api('POST', '/api/order/pay', BT, { order_id: RID_ORDER });
await api('PUT', '/api/order/ship', ST, { order_id: RID_ORDER });
await api('PUT', '/api/order/confirm', BT, { order_id: RID_ORDER });

const review = await api('POST', '/api/review', BT, { order_id: RID_ORDER, score: 4, content: '包布料厚实，提手缝线工整。' });
check('订单完成后发表评价', review.json.code === 0, review.json.message);

const received = await api('GET', '/api/review/mine?role=received', ST);
const RID = received.json.data.list.find((r) => r.order_id === RID_ORDER).review_id;
check('订单列表能定位到本次评价', !!RID, 'review#' + RID);

const notMine = await api('PUT', `/api/review/${RID}/additional`, ST, { content: '卖家不能替买家追加' });
check('非本人追加被拦截(403)', notMine.status === 403, notMine.json.message);
const emptyAdd = await api('PUT', `/api/review/${RID}/additional`, BT, { content: '  ' });
check('空内容追加被拦截(400)', emptyAdd.status === 400, emptyAdd.json.message);

const appended = await api('PUT', `/api/review/${RID}/additional`, BT, { content: '追加：背了一周，装三本书没变形，拉链顺滑。' });
check('作者本人追加成功', appended.json.code === 0, appended.json.message);
const appendedAgain = await api('PUT', `/api/review/${RID}/additional`, BT, { content: '再追加一次' });
check('追加仅限一次(400)', appendedAgain.status === 400, appendedAgain.json.message);

const list = await api('GET', '/api/order?role=buyer', BT);
const thatOne = list.json.data.list.find((o) => o.order_id === RID_ORDER);
check('订单列表返回 my_review_id', thatOne.my_review_id === RID);
check('订单列表返回追加状态 additional_added=1', thatOne.additional_added === 1);

const goodsDetail = await api('GET', '/api/goods/' + NG);
check('商品详情展示追加评价', !!goodsDetail.json.data.reviews[0].additional);

// ---------- 浏览器层 ----------
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(os.tmpdir(), 'cm-v11-' + Date.now())}`,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

async function waitJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Chrome 未就绪');
}
const list0 = await waitJson(`http://127.0.0.1:${PORT}/json/list`);
const page = list0.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++mid; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('超时 ' + method)); } }, 20000);
});
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + '/' });
  await new Promise((r) => setTimeout(r, 800));
  await evaluate(`localStorage.setItem('cm_token', ${JSON.stringify(BT)});localStorage.setItem('cm_user', ${JSON.stringify(JSON.stringify({ ...buyer.json.data.user, type: 'user' }))});'ok'`);
  await send('Page.navigate', { url: BASE + '/#/orders' });
  await new Promise((r) => setTimeout(r, 1400));

  const ui = await evaluate(`(()=>{
    const txt=(document.getElementById('app')||{}).innerText||'';
    return {
      reasonShown: txt.includes('取消原因（买家）：拍错了颜色，重新下单'),
      appendedBadge: txt.includes('已追加'),
      noStaleAppendBtn: ![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='追加评价'&&txt.includes('已追加')),
    };})()`);
  check('订单卡片展示取消原因与取消人', ui.reasonShown);
  check('已追加的订单显示「已追加」徽章', ui.appendedBadge);
  await send('Page.captureScreenshot', { format: 'png' }).then((r) => fs.writeFileSync(path.join(SHOT_DIR, 'regression-v11-orders.png'), Buffer.from(r.data, 'base64')));
} catch (e) {
  console.error('浏览器环节失败:', e.message);
  fail++;
} finally {
  ws.close(); proc.kill();
}

console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====\n`);
process.exit(fail ? 1 : 0);
