// 通用工具：统一响应、请求体解析、业务异常、路由匹配
import { URL } from 'node:url';

/** 业务异常：带 HTTP 状态码与统一错误码 */
export class ApiError extends Error {
  constructor(message, status = 400, code = 400) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const bad = (msg) => new ApiError(msg, 400, 400);
export const unauthorized = (msg = '未登录或登录已过期') => new ApiError(msg, 401, 401);
export const forbidden = (msg = '无权限执行该操作') => new ApiError(msg, 403, 403);
export const notFound = (msg = '资源不存在') => new ApiError(msg, 404, 404);

/** 统一成功响应：{ code:0, message, data } */
export function ok(res, data = null, message = 'success') {
  send(res, 200, { code: 0, message, data });
}

export function send(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** 读取并解析 JSON 请求体（限制 8MB，容纳商品图片的 base64 数据） */
export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 8 * 1024 * 1024) {
        reject(new ApiError('请求体过大（图片过多或过大，单张请控制在 1MB 以内）', 413, 413));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(bad('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---------- 商品图片 ----------
// 图片以 JSON 数组字符串存储：["data:image/jpeg;base64,...", "https://..."]
// 兼容历史数据（逗号分隔的普通 URL，或空串）。
export const MAX_IMAGES = 3;                      // 每个商品最多 3 张
export const MAX_IMAGE_CHARS = 1_400_000;         // 单张上限（base64 字符数，约 1MB 原始图）

export function serializeImages(list) {
  if (list === undefined || list === null || list === '') return '[]';
  if (typeof list === 'string') return JSON.stringify(parseImages(list));
  const arr = (Array.isArray(list) ? list : [list]).map((s) => String(s).trim()).filter(Boolean);
  if (arr.length > MAX_IMAGES) throw bad(`商品图片最多 ${MAX_IMAGES} 张`);
  for (const img of arr) {
    if (img.length > MAX_IMAGE_CHARS) throw bad('单张图片过大，请压缩后重新上传（建议 1MB 以内）');
    if (!/^(data:image\/(png|jpe?g|gif|webp|bmp);base64,|https?:\/\/)/i.test(img)) {
      throw bad('图片格式不受支持，请上传 JPG / PNG / GIF / WebP 图片');
    }
  }
  return JSON.stringify(arr);
}

export function parseImages(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr.filter(Boolean) : [];
    } catch {
      /* 落到下面的逗号分隔兜底 */
    }
  }
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

/** 把商品行里的 images 字段由字符串规范化为数组，供接口返回 */
export function normalizeGoodsRow(row) {
  if (!row) return row;
  return { ...row, images: parseImages(row.images) };
}

/** 极简路由：支持 /api/goods/:id 形式 */
export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler) => {
    const keys = [];
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/\/:([A-Za-z0-9_]+)/g, (_, k) => {
            keys.push(k);
            return '/([^/]+)';
          })
          .replace(/\//g, '\\/') +
        '$'
    );
    routes.push({ method, regex, keys, handler });
  };
  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    delete: (p, h) => add('DELETE', p, h),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.regex.exec(pathname);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { handler: r.handler, params };
      }
      return null;
    },
  };
}

export function parseUrl(req) {
  return new URL(req.url, `http://${req.headers.host || 'localhost'}`);
}

/** 生成订单号：CM + yyyyMMddHHmmss + 4位随机 */
export function genOrderNo() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`;
  return `CM${ts}${Math.floor(1000 + Math.random() * 9000)}`;
}

export const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/** 分页参数归一化 */
export function pager(query) {
  const page = Math.max(1, parseInt(query.get('page') || '1', 10) || 1);
  const size = Math.min(50, Math.max(1, parseInt(query.get('size') || '8', 10) || 8));
  return { page, size, offset: (page - 1) * size };
}
