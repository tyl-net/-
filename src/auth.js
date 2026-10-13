// 鉴权：scrypt 密码哈希 + JWT(HS256) 令牌，全部基于 node:crypto，零依赖
import crypto from 'node:crypto';
import { unauthorized, forbidden } from './util.js';

/**
 * 签名密钥：刻意使用固定常量，不读取环境变量。
 * 原因：部署平台可能注入随机的 JWT_SECRET，且请求会在多个实例/进程间轮转，
 * 导致「A 进程签发、B 进程校验」时令牌互不认可（表现为刚登录就 401）。
 * 本项目为自包含演示系统，固定密钥可在多实例间保持一致。
 * 生产环境应改为从密钥管理服务读取并在实例间共享。
 */
const SECRET = 'campus-market-jwt-secret-v1-2026-fixed';
const TOKEN_TTL = 2 * 60 * 60; // 2 小时，与《系统设计说明书》7.1 一致

/** 密钥指纹（仅用于部署诊断，不含密钥本身） */
export const secretFingerprint = crypto.createHash('sha256').update(SECRET).digest('hex').slice(0, 12);

/** 密码加密：scrypt(随机盐)，存储格式 scrypt$salt$hash */
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(plain, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  const calc = crypto.scryptSync(String(plain), salt, 32).toString('hex');
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** 签发 JWT：{ sub, type:'user'|'admin', nickname } */
export function signToken(payload, ttl = TOKEN_TTL) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat, exp: iat + ttl };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expect = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  const a = Buffer.from(s);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * 收集请求中所有可能的令牌候选（按优先级），逐个尝试验签并取第一个通过的。
 *
 * 之所以要「逐个试」而不是「取第一个存在的」：云平台的反向代理会给每个请求
 * 注入它自己的 `Authorization` 头，如果只读 Authorization 就会永远读到网关的令牌，
 * 应用自己签发的令牌反而永远用不上（表现为刚登录就 401）。
 * 网关的令牌签名不同，自然验签失败，于是自动落到下一个候选通道。
 */
function tokenCandidates(req) {
  const list = [];
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) list.push(auth.slice(7).trim());
  const custom = req.headers['x-auth-token'];
  if (custom) list.push(String(custom).trim());
  const cookie = req.headers['cookie'] || '';
  const m = /(?:^|;\s*)cm_token=([^;]*)/.exec(cookie);
  if (m && m[1]) list.push(decodeURIComponent(m[1]));
  const q = /[?&]token=([^&]+)/.exec(req.url || '');
  if (q) list.push(decodeURIComponent(q[1]));
  return list.filter(Boolean);
}

/** 从请求中解析当前登录主体：任一通道验签通过即可 */
export function currentUser(req) {
  for (const token of tokenCandidates(req)) {
    const u = verifyToken(token);
    if (u) return u;
  }
  return null;
}

/**
 * 要求学生用户身份。
 * 关键区分：令牌验不过 → 401（未认证，前端会清会话重新登录）；
 *           令牌有效但身份是管理员 → 403（身份不符，前端仅提示、绝不清会话）。
 * 此前管理员令牌误入用户接口也会抛 401，导致前端把有效会话当成"登录已过期"强制登出。
 */
export function requireUser(req) {
  const u = currentUser(req);
  if (!u) throw unauthorized();
  if (u.type !== 'user') throw forbidden('该功能仅面向学生用户账号，管理员无需实名认证与交易');
  return u;
}

/** 要求管理员 */
export function requireAdmin(req) {
  const u = currentUser(req);
  if (!u || u.type !== 'admin') throw forbidden('需要管理员权限');
  return u;
}

export { TOKEN_TTL };
