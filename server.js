// 校园二手交易平台 —— 服务入口
// 零外部依赖：node:http + node:sqlite + node:crypto
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouter, parseUrl, ok, send, readBody, ApiError, notFound } from './src/util.js';
import { currentUser, secretFingerprint } from './src/auth.js';
import { db, seedIfEmpty, CATEGORIES, QUALITIES, ORDER_STATUS, AUDIT_STATUS } from './src/db.js';
import { registerUser } from './src/routes/user.js';
import { registerGoods } from './src/routes/goods.js';
import { registerOrder } from './src/routes/order.js';
import { registerReview } from './src/routes/review.js';
import { registerAdmin } from './src/routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
// 本地默认 127.0.0.1 即可；容器/云环境需绑定 0.0.0.0 才能被反向代理访问
const HOST = process.env.HOST || '0.0.0.0';

// ---------- 初始化数据库与种子数据 ----------
const seeded = seedIfEmpty();

// ---------- 路由 ----------
const router = createRouter();

// 元数据：类别/成色/状态字典，供前端下拉使用
router.get('/api/meta', async (req, res) => {
  const announcements = db
    .prepare('SELECT id,title,content,created_at FROM t_announcement WHERE status=1 ORDER BY id DESC')
    .all();
  return ok(res, {
    categories: CATEGORIES,
    qualities: QUALITIES,
    orderStatus: ORDER_STATUS,
    auditStatus: AUDIT_STATUS,
    announcements,
  });
});

// 部署环境诊断：确认反向代理是否把鉴权信息转发到了应用（只返回存在性，不返回内容）
router.get('/api/diagnostics', async (req, res) => {
  const hd = req.headers;
  return ok(res, {
    hasAuthorization: !!hd['authorization'],
    hasXAuthToken: !!hd['x-auth-token'],
    hasCookie: !!hd['cookie'],
    cookieHasToken: /cm_token=/.test(hd['cookie'] || ''),
    forwardedProto: hd['x-forwarded-proto'] || null,
    host: hd['host'] || null,
    secretFingerprint,
    jwtSecretFromEnv: !!process.env.JWT_SECRET,
    pid: process.pid,
    tokenReceived: !!currentUser(req),
  });
});

// 平台公开统计（预留接口：集市首页已不再展示运营数据，运营数据在管理员「数据看板」查看）
router.get('/api/stats/overview', async (req, res) => {
  const one = (sql) => Number(db.prepare(sql).get().v || 0);
  return ok(res, {
    goodsOnSale: one('SELECT COUNT(*) AS v FROM t_goods WHERE audit_status=1 AND goods_status=1'),
    userTotal: one('SELECT COUNT(*) AS v FROM t_user'),
    orderDone: one('SELECT COUNT(*) AS v FROM t_order WHERE order_status=3'),
    gmv: Number(db.prepare('SELECT IFNULL(SUM(amount),0) AS v FROM t_order WHERE order_status=3').get().v),
  });
});

// 公开公告列表
router.get('/api/announcements', async (req, res) => {
  const list = db
    .prepare('SELECT id,title,content,created_at FROM t_announcement WHERE status=1 ORDER BY id DESC')
    .all();
  return ok(res, { list });
});

registerUser(router);
registerGoods(router);
registerOrder(router);
registerReview(router);
registerAdmin(router);

// ---------- 静态资源 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  if (!fs.existsSync(filePath)) return false;
  // 目录请求 → 返回该目录下的 index.html（如 /design-system/）
  if (fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    if (!fs.existsSync(filePath)) return false;
  }
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
  });
  res.end(body);
  return true;
}

// ---------- 服务器 ----------
const server = http.createServer(async (req, res) => {
  const url = parseUrl(req);
  const pathname = url.pathname;

  // 跨域（便于本地调试）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // API 路由
  if (pathname.startsWith('/api/')) {
    const hit = router.match(req.method, pathname);
    if (!hit) return send(res, 404, { code: 404, message: `接口不存在: ${req.method} ${pathname}` });
    try {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      await hit.handler(req, res, body, hit.params);
    } catch (err) {
      // 全局异常处理器：统一错误码，不暴露内部细节
      if (err instanceof ApiError) {
        return send(res, err.status, { code: err.code, message: err.message });
      }
      console.error('[未捕获异常]', err);
      return send(res, 500, { code: 500, message: '服务器内部错误，请稍后重试' });
    }
    return;
  }

  // 静态资源
  if (serveStatic(req, res, pathname)) return;

  // 其余路径回落到首页（前端路由）
  if (req.method === 'GET' && !pathname.includes('.')) {
    if (serveStatic(req, res, '/index.html')) return;
  }

  send(res, 404, { code: 404, message: 'Not Found' });
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log('  │        校园二手交易平台  已启动              │');
  console.log('  ├──────────────────────────────────────────────┤');
  console.log(`  │  访问地址: http://${HOST}:${PORT}${' '.repeat(Math.max(0, 27 - String(PORT).length - HOST.length))}│`);
  console.log('  ├──────────────────────────────────────────────┤');
  console.log('  │  演示账号（密码均为 123456）                 │');
  console.log('  │   买家/卖家  241603010213  谭以勒            │');
  console.log('  │   卖家       241603010301  李思远            │');
  console.log('  │   管理员     admin         平台超级管理员    │');
  console.log('  └──────────────────────────────────────────────┘');
  console.log(`  种子数据: ${seeded ? '已初始化' : '已存在（跳过）'}`);
  console.log('');
});
