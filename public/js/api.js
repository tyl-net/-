// API 封装：统一携带 JWT、统一错误处理、全局会话状态
const TOKEN_KEY = 'cm_token';
const USER_KEY = 'cm_user';

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY) || ''; },
  get user() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } },
  get isAdmin() { return !!this.user && this.user.type === 'admin'; },
  save(token, user, type) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify({ ...user, type }));
    // 同步写入 Cookie：部分反向代理会剥离 Authorization 头，Cookie 是最稳的兜底通道
    document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=7200; SameSite=Lax`;
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    document.cookie = `${TOKEN_KEY}=; path=/; max-age=0; SameSite=Lax`;
  },
};

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(method, path, body, { auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && session.token) {
    headers['Authorization'] = 'Bearer ' + session.token;
    headers['X-Auth-Token'] = session.token;
  }
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json;
  try { json = await res.json(); } catch { throw new ApiError('服务器响应异常', res.status); }
  if (res.status === 401 && auth) {
    session.clear();
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }
  if (json.code !== 0) throw new ApiError(json.message || '请求失败', res.status);
  return json.data;
}

export const api = {
  get: (p, o) => request('GET', p, null, o),
  post: (p, b, o) => request('POST', p, b, o),
  put: (p, b, o) => request('PUT', p, b, o),
  del: (p, o) => request('DELETE', p, null, o),
};

export const qs = (obj) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== '' && v !== null && v !== undefined) s.set(k, v);
  }
  return s.toString();
};
