// 真实浏览器验证：启动 headless Chrome，通过 CDP 逐个加载各页面，
// 捕获 JS 异常 / 控制台错误，断言关键内容渲染成功，并截图存档。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:/Users/33465/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const PORT = 9333;
const SHOT_DIR = path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const profile = path.join(os.tmpdir(), 'cm-chrome-' + Date.now());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome 调试端口未就绪: ' + url);
}

/** 极简 CDP 客户端 */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        c.events.push(msg);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); }
      }, 20000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面内异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  drainErrors() {
    const errs = [];
    for (const e of this.events) {
      if (e.method === 'Runtime.exceptionThrown') {
        const d = e.params.exceptionDetails;
        errs.push('未捕获异常: ' + (d.exception?.description || d.text));
      }
      if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
        errs.push('console.error: ' + e.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
      if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
        // 过滤网络层资源日志：负向用例（如重名昵称被拒）会故意触发 400，
        // 真正的 JS 异常/接口处理错误走 Runtime.exceptionThrown 与 console.error，不受影响
        if (/Failed to load resource/.test(e.params.entry.text)) continue;
        errs.push('日志错误: ' + e.params.entry.text);
      }
    }
    this.events.length = 0;
    return errs;
  }
}

async function api(path, { method = 'GET', body, token } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${extra ? '  → ' + extra : ''}`);
  ok ? pass++ : fail++;
};

const run = async () => {
  console.log('\n===== 浏览器端渲染与交互验证 =====\n');
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore' });

  let cdp;
  try {
    await waitJson(`http://127.0.0.1:${PORT}/json/version`);
    const list = await waitJson(`http://127.0.0.1:${PORT}/json/list`);
    const page = list.find((t) => t.type === 'page');
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

    /** 等待 #app 挂载（页面加载失败时给出明确提示，避免静默 null） */
    const waitApp = async (tries = 40) => {
      for (let i = 0; i < tries; i++) {
        try {
          const has = await cdp.eval('!!document.getElementById("app")');
          if (has) return true;
        } catch {}
        await sleep(200);
      }
      throw new Error('页面未挂载 #app，可能未连接到服务: ' + BASE);
    };
    /** 等待页面真正渲染出内容（远端冷启动可能较慢），返回当前文本 */
    const waitRender = async (tries = 60) => {
      let last = '';
      for (let i = 0; i < tries; i++) {
        last = await cdp.eval('(document.getElementById("app")||{}).innerText || ""');
        if (last.trim().length > 0) return last;
        await sleep(250);
      }
      return last;
    };
    /** 等待文本中出现指定内容（用于异步加载的数据区域） */
    const waitText = async (needle, tries = 60) => {
      let last = '';
      for (let i = 0; i < tries; i++) {
        last = await cdp.eval('(document.getElementById("app")||{}).innerText || ""');
        if (last.includes(needle)) return last;
        await sleep(250);
      }
      return last;
    };
    /** 轮询等待页面条件成立（远程环境下异步渲染需要） */
    const waitUntil = async (expr, tries = 80) => {
      for (let i = 0; i < tries; i++) {
        const ok = await cdp.eval(`(()=>{try{return !!(${expr});}catch{return false;}})()`);
        if (ok) return true;
        await sleep(250);
      }
      return false;
    };
    const goto = async (hash, waitMs = 300) => {
      await cdp.send('Page.navigate', { url: BASE + '/' + (hash || '') });
      await waitApp();
      await waitRender();
      if (waitMs) await sleep(waitMs);
    };
    /** 切换登录态：写入对应存储（管理员→sessionStorage 本标签页；学生→localStorage）后强制整页重载 */
    const loginAs = async (token, user, hash, waitMs = 300) => {
      const admin = user.type === 'admin';
      const script = admin
        ? `sessionStorage.setItem('cm_admin_token', ${JSON.stringify(token)});` +
          `sessionStorage.setItem('cm_admin', ${JSON.stringify(JSON.stringify(user))}); 'ok'`
        : `localStorage.setItem('cm_token', ${JSON.stringify(token)});` +
          `localStorage.setItem('cm_user', ${JSON.stringify(JSON.stringify(user))}); 'ok'`;
      await cdp.eval(script);
      await cdp.send('Page.navigate', { url: BASE + '/' + (hash || '') });
      await sleep(250);
      await cdp.send('Page.reload', {});
      await waitApp();
      await waitRender();
      if (waitMs) await sleep(waitMs);
    };
    const text = () => cdp.eval('(document.getElementById("app")||{}).innerText || ""');
    /** 等待商品卡片真正渲染出来 */
    const waitCards = async (tries = 60) => {
      for (let i = 0; i < tries; i++) {
        const n = await cdp.eval('document.querySelectorAll(".goods-card").length');
        if (n > 0) return n;
        await sleep(250);
      }
      return 0;
    };
    const shot = async (name) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(data, 'base64'));
    };

    // ---------- 1. 未登录 → 登录页 ----------
    await goto('#/login');
    let t = await waitText('登 录');
    check('登录页渲染', t.includes('校园集市') && t.includes('登 录'), `${t.length} 字符`);
    check('演示账号提示可见', t.includes('241603010213') && t.includes('123456'));
    await shot('01-登录页');
    check('登录页无 JS 错误', cdp.drainErrors().length === 0, cdp.drainErrors().join(' | '));

    // ---------- 2. 买家登录并浏览集市 ----------
    const buyer = await api('/api/user/login', { method: 'POST', body: { student_no: '241603010213', password: '123456' } });
    const BT = buyer.data.token;
    await loginAs(BT, { ...buyer.data.user, type: 'user' }, '#/home');
    await waitCards();
    t = await waitText('二手集市');
    check('集市首页渲染', t.includes('二手集市') && t.includes('搜索'));
    check('商品卡片加载', /¥\d+\.\d{2}/.test(t), (t.match(/¥[\d.]+/g) || []).slice(0, 3).join(' '));
    check('分类筛选条渲染', t.includes('教材书籍') && t.includes('电子数码'));
    check('公告展示', t.includes('公告') || t.includes('公约') || t.includes('专场'));
    await shot('02-集市首页');

    // ---------- 3. 搜索交互 ----------
    const searched = await cdp.eval(`(async () => {
      const input = document.querySelector('.search-box input');
      input.value = '英语';
      const btn = [...document.querySelectorAll('.search-box button')].find(b => b.textContent.includes('搜索'));
      btn.click();
      await new Promise(r => setTimeout(r, 1200));
      return document.querySelector('.goods-grid').innerText;
    })()`);
    check('关键词搜索交互生效', searched.includes('英语'), searched.replace(/\n/g, ' / ').slice(0, 60));
    await shot('03-搜索结果');

    // ---------- 4. 商品详情 ----------
    await cdp.eval(`document.querySelector('.goods-card').click(); 'ok'`);
    await sleep(1200);
    t = await text();
    check('商品详情页渲染', t.includes('商品描述') && t.includes('卖家'), t.slice(0, 50).replace(/\n/g, ' '));
    check('购买按钮存在', t.includes('立即购买') || t.includes('已售出'));
    await shot('04-商品详情');

    /** 通过 CDP 给页面上的隐藏 file input 注入真实文件（验证图片上传链路） */
    const setFileInput = async (selector, absPaths) => {
      await cdp.send('DOM.enable');
      const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error('未找到文件输入元素: ' + selector);
      await cdp.send('DOM.setFileInputFiles', { files: absPaths, nodeId });
    };
    const FIXTURE = path.join(__dirname, 'fixtures', 'pic.png');

    // ---------- 5. 发布页 ----------
    await goto('#/publish');
    t = await waitText('商品图片');
    check('发布闲置页渲染', t.includes('发布闲置') && t.includes('商品名称'));
    check('实名状态提示', t.includes('实名'));
    check('存在图片上传控件（非文本输入）', await cdp.eval('!!document.querySelector(".img-picker .img-add")'),
      '上传按钮：' + (await cdp.eval('document.querySelector(".img-add-text")?.textContent || ""')));
    await shot('05-发布闲置');

    // 真实选择文件 → 客户端压缩 → 生成预览
    await setFileInput('.img-picker input[type=file]', [FIXTURE]);
    let cells = 0;
    for (let i = 0; i < 30; i++) {
      cells = await cdp.eval('document.querySelectorAll(".img-picker .img-cell").length');
      if (cells > 0) break;
      await sleep(250);
    }
    check('选择本地图片后生成预览', cells === 1, `${cells} 张预览`);
    check('第一张标记为封面', await cdp.eval('!!document.querySelector(".img-cover-tag")'));
    check('预览为压缩后的 data URI', await cdp.eval('(document.querySelector(".img-cell img")?.src || "").startsWith("data:image/jpeg;base64,")'));
    await shot('05b-发布闲置-已选图片');
    // 移除再看
    await cdp.eval('document.querySelector(".img-del").click(); "ok"');
    await sleep(300);
    check('可移除已选图片', (await cdp.eval('document.querySelectorAll(".img-picker .img-cell").length')) === 0);

    // ---------- 6. 我的商品 ----------
    await goto('#/my-goods');
    // 列表为异步加载：远程环境下须等骨架屏/「加载中」消失、行内按钮出现，否则断言会早于渲染
    await waitUntil(`!document.getElementById('app').innerText.includes('加载中')`, 80);
    await waitUntil(`!!document.querySelector('.card button')`, 80);
    t = await waitText('我的商品');
    check('我的商品页渲染', t.includes('我的商品'), t.slice(0, 40).replace(/\n/g, ' '));
    check('商品行含「删除」按钮', t.includes('删除'));
    await shot('06-我的商品');

    // 打开编辑弹窗，确认含商品图片字段
    const editInfo = await cdp.eval(`(async () => {
      const btn = [...document.querySelectorAll('.card button')].find(b => b.textContent.trim() === '编辑');
      if (!btn) return { found: false };
      btn.click();
      await new Promise(r => setTimeout(r, 800));
      const root = document.getElementById('modal-root');
      const txt = root ? root.innerText : '';
      return {
        found: true,
        title: root?.querySelector('.modal-head h3')?.textContent || '',
        hasImagesField: txt.includes('商品图片'),
        hasPicker: !!root?.querySelector('.img-picker'),
        hasAddBtn: !!root?.querySelector('.img-add'),
      };
    })()`);
    check('可打开编辑弹窗', editInfo.found && editInfo.title === '编辑商品', editInfo.title || '未找到编辑按钮');
    check('编辑弹窗含「商品图片」字段', !!editInfo.hasImagesField);
    check('编辑弹窗含图片选择器', !!editInfo.hasPicker && !!editInfo.hasAddBtn);
    await shot('06b-编辑商品-含图片');
    await cdp.eval(`(() => { const b = document.querySelector('#modal-root .modal-head .icon-btn'); if (b) b.click(); return 'ok'; })()`);
    await sleep(400);

    // ---------- 7. 订单页 ----------
    await goto('#/orders', 1400);
    t = await text();
    check('我的订单页渲染', t.includes('我买到的') && t.includes('我卖出的'));
    check('订单卡片渲染', t.includes('订单号') || t.includes('还没有'), '');
    await shot('07-我的订单');

    // ---------- 8. 卖家视角订单 ----------
    const seller = await api('/api/user/login', { method: 'POST', body: { student_no: '241603010301', password: '123456' } });
    const ST = seller.data.token;
    await loginAs(ST, { ...seller.data.user, type: 'user' }, '#/orders', 1400);
    t = await text();
    check('卖家视角订单页', t.includes('我卖出的'));

    // ---------- 9. 评价中心 ----------
    await goto('#/reviews', 1300);
    t = await text();
    check('评价中心渲染', t.includes('评价中心') && t.includes('我发出的'));
    await shot('08-评价中心');

    // ---------- 10. 个人中心 ----------
    await goto('#/profile', 1300);
    t = await text();
    check('个人中心渲染', t.includes('信用分') && t.includes('账号安全'));
    check('实名认证状态展示', t.includes('实名'));

    // 头像：接口设置图片头像 → 渲染为图片头像；随后不带头像的资料编辑不清除头像、不误改昵称
    const avatarFlow = await cdp.eval(`(async () => {
      const T = localStorage.getItem('cm_token');
      const svg = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#0e9f8e"/><text x="32" y="44" font-size="30" text-anchor="middle" fill="#fff" font-family="sans-serif">像</text></svg>');
      const put = async (body) => {
        const r = await fetch('/api/user/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': T }, body: JSON.stringify(body) });
        return { status: r.status, json: await r.json() };
      };
      const before = await (await fetch('/api/user/profile', { headers: { 'X-Auth-Token': T } })).json();
      const r1 = await put({ avatar: svg });
      const r2 = await put({ phone: before.data.user.phone || '13800000002' });
      const r3 = await put({ nickname: '王雨桐' });
      return {
        set: r1.json.code === 0,
        kept: r2.json.code === 0 && typeof r2.json.data.user.avatar === 'string' && r2.json.data.user.avatar.startsWith('data:image'),
        nickname: r2.json.data.user.nickname,
        dupCode: r3.status,
        dupMsg: r3.json.message,
      };
    })()`);
    check('设置图片头像成功', avatarFlow.set === true);
    check('不带头像的资料编辑保留头像', avatarFlow.kept === true);
    check('资料编辑不误改昵称', avatarFlow.nickname === '李思远', '昵称=' + avatarFlow.nickname);
    check('重名昵称被拒绝(400)', avatarFlow.dupCode === 400, avatarFlow.dupMsg);
    // 相同 hash 的 goto 不会触发 SPA 重渲染，必须整页刷新后才能看到新头像
    await cdp.send('Page.reload', {});
    await waitApp();
    await waitRender();
    await sleep(600);
    const hasAvatarImg = await cdp.eval(`!!document.querySelector('.avatar img')`);
    check('头像渲染为上传图片', !!hasAvatarImg);

    // 昵称修改后右上角应即时更新（无需手动刷新）
    await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑资料')?.click(); 1`);
    await sleep(500);
    await cdp.eval(`(() => { const el = [...document.querySelectorAll('#modal-root .form input')][0]; el.value = '李思远Pro'; el.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    await cdp.eval(`[...document.querySelectorAll('#modal-root button')].find(b => b.textContent.trim() === '保存')?.click(); 1`);
    await sleep(900);
    const chip = await cdp.eval(`(document.querySelector('.userchip-name')||{}).textContent || ''`);
    check('修改昵称后右上角即时更新', chip === '李思远Pro', chip);

    // 恢复昵称并同步本地会话
    await cdp.eval(`(async () => {
      const T = localStorage.getItem('cm_token');
      const r = await (await fetch('/api/user/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': T }, body: JSON.stringify({ nickname: '李思远' }) })).json();
      const u = JSON.parse(localStorage.getItem('cm_user'));
      u.nickname = r.data.user.nickname; u.avatar = r.data.user.avatar;
      localStorage.setItem('cm_user', JSON.stringify(u));
      location.reload();
      return r.code;
    })()`);
    await waitApp();
    await waitRender();
    await sleep(500);
    await shot('09-个人中心');

    // ---------- 11. 普通用户访问管理后台 → 权限拦截 ----------
    await goto('#/admin', 1200);
    t = await text();
    check('普通用户被拦截管理后台', t.includes('需要管理员权限'));

    // ---------- 12. 管理员登录（双会话：不影响同浏览器的学生登录） → 各后台页面 ----------
    const studentTokenBefore = await cdp.eval(`localStorage.getItem('cm_token')`);
    const admin = await api('/api/admin/login', { method: 'POST', body: { account: 'admin', password: '123456' } });
    const AT = admin.data.token;
    await loginAs(AT, { ...admin.data.admin, type: 'admin' }, '#/admin');
    check('双会话互不干扰：学生登录态仍在', (await cdp.eval(`localStorage.getItem('cm_token')`)) === studentTokenBefore);
    check('管理员会话写入本标签页', (await cdp.eval(`!!sessionStorage.getItem('cm_admin_token')`)));
    t = await waitText('累计成交额');
    check('数据看板渲染', t.includes('数据看板') && t.includes('累计成交额'));
    check('统计卡片有数值', /注册用户/.test(t) && /\d/.test(t));
    check('类别分布图渲染', t.includes('在售商品类别分布'));
    await shot('10-管理后台-数据看板');

    await goto('#/admin/audit', 1400);
    t = await text();
    check('商品审核页渲染', t.includes('商品审核') && (t.includes('待审核') || t.includes('暂无')));
    await shot('11-管理后台-商品审核');

    await goto('#/admin/users', 1400);
    t = await text();
    check('用户管理页渲染', t.includes('用户管理') && t.includes('信用分'));
    check('用户列表有数据', t.includes('241603010213') || t.includes('谭以勒'));
    await shot('12-管理后台-用户管理');

    await goto('#/admin/reports', 1400);
    t = await text();
    check('举报处理页渲染', t.includes('举报处理'));
    await shot('13-管理后台-举报处理');

    await goto('#/admin/announcements', 1300);
    t = await text();
    check('公告管理页渲染', t.includes('公告管理'));
    await shot('14-管理后台-公告管理');

    await goto('#/admin/logs', 1300);
    t = await text();
    check('审计日志页渲染', t.includes('审计日志') && t.includes('动作'));
    check('操作者显示真实身份（昵称/姓名+账号）', t.includes('谭以勒（241603010213）') && t.includes('平台超级管理员（admin）'));
    check('动作列显示中文对照（保留原码备查）', t.includes('管理员登录') && t.includes('ADMIN_LOGIN'));
    await shot('15-管理后台-审计日志');

    // ---------- 13. 全流程无 JS 错误 ----------
    const errs = cdp.drainErrors().filter((e) => !/favicon/i.test(e));
    check('全程无 JS 异常/控制台错误', errs.length === 0, errs.slice(0, 3).join(' | '));

    console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====`);
    console.log(`截图目录：${SHOT_DIR}\n`);
  } finally {
    try { cdp?.ws.close(); } catch {}
    proc.kill();
    await sleep(600);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('验证执行异常：', e); process.exit(1); });
