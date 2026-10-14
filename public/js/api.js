// API 封装：统一携带 JWT、统一错误处理、全局会话状态
// 会话模型（支持"一个页面登学生、一个页面登管理员"）：
//   学生用户  → localStorage（跨标签页共享、持久）
//   管理员    → sessionStorage（每个标签页独立，关标签页即退出）
// 调用 /api/admin/* 时自动携带管理员会话，其余接口携带学生会话。
const TOKEN_KEY = 'cm_token';
const USER_KEY = 'cm_user';
const ATOKEN_KEY = 'cm_admin_token';
const ADMIN_KEY = 'cm_admin';

const readJSON = (raw) => { try { return JSON.parse(raw || 'null'); } catch { return null; } };

export const session = {
  // —— 学生用户会话 ——
  get token() { return localStorage.getItem(TOKEN_KEY) || ''; },
  get user() {
    const u = readJSON(localStorage.getItem(USER_KEY));
    return u && u.type === 'user' ? u : null;
  },
  saveUser(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify({ ...user, type: 'user' }));
    // 同步写入 Cookie：部分反向代理会剥离 Authorization 头，Cookie 是最稳的兜底通道
    document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=7200; SameSite=Lax`;
  },
  clearUser() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    document.cookie = `${TOKEN_KEY}=; path=/; max-age=0; SameSite=Lax`;
  },

  // —— 管理员会话（仅本标签页） ——
  get adminToken() { return sessionStorage.getItem(ATOKEN_KEY) || ''; },
  get admin() {
    const a = readJSON(sessionStorage.getItem(ADMIN_KEY));
    return a && a.type === 'admin' ? a : null;
  },
  saveAdmin(token, admin) {
    sessionStorage.setItem(ATOKEN_KEY, token);
    sessionStorage.setItem(ADMIN_KEY, JSON.stringify({ ...admin, type: 'admin' }));
  },
  clearAdmin() {
    sessionStorage.removeItem(ATOKEN_KEY);
    sessionStorage.removeItem(ADMIN_KEY);
  },

  // —— 兼容旧调用 ——
  get isAdmin() { return !!this.admin; },
  save(token, user, role) { role === 'admin' ? this.saveAdmin(token, user) : this.saveUser(token, user); },
  clear() { this.clearUser(); this.clearAdmin(); },

  /** 一次性迁移：旧版把管理员会话存在全局用户槽位，迁到本标签页的管理员会话 */
  migrateLegacy() {
    const u = readJSON(localStorage.getItem(USER_KEY));
    if (u && u.type === 'admin') {
      if (!this.admin) this.saveAdmin(localStorage.getItem(TOKEN_KEY) || '', u);
      this.clearUser();
    }
  },
};

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(method, path, body, { auth = true } = {}) {
  // 按接口归属选择会话：管理接口用管理员会话，其余用学生会话
  const adminApi = /^\/api\/admin\//.test(path);
  const token = adminApi ? session.adminToken : session.token;
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) {
    headers['Authorization'] = 'Bearer ' + token;
    headers['X-Auth-Token'] = token;
  }
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json;
  try { json = await res.json(); } catch { throw new ApiError('服务器响应异常', res.status); }
  if (res.status === 401 && auth) {
    // 只清空对应身份的会话：管理员登录过期不影响同浏览器里的学生登录
    if (adminApi) { session.clearAdmin(); window.dispatchEvent(new CustomEvent('admin:expired')); }
    else { session.clearUser(); window.dispatchEvent(new CustomEvent('auth:expired')); }
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
