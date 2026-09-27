import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './http.js';

const scryptAsync = promisify(scrypt);
const ADMIN_COOKIE = 'sl_admin';
const ADMIN_MAX_AGE = 7 * 24 * 3600;
const LIST_MAX_AGE = 30 * 24 * 3600;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET is missing or too short');
  return s;
}

function safeEqual(a, b) {
  // 先雜湊成固定長度，避免 timingSafeEqual 因長度不同而洩漏資訊
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(String(password), Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 4 || password.length > 100) {
    throw new HttpError(400, '密碼長度需為 4–100 個字元');
  }
}

// 密碼錯誤時延遲回應，減緩暴力嘗試
export const failDelay = () => new Promise((r) => setTimeout(r, 800));

function sign(payload) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function makeToken(payload, maxAge) {
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  return `${exp}.${sign(`${payload}|${exp}`)}`;
}

function checkToken(token, payload) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, sign(`${payload}|${exp}`));
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(req, res, name, value, maxAge) {
  const isLocal = /^(localhost|127\.0\.0\.1)(:|$)/.test(req.headers.host || '');
  const attrs = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (!isLocal) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

// ---- 管理者 ----

export async function adminLogin(req, res, password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new Error('ADMIN_PASSWORD is not set');
  if (!safeEqual(password, expected)) {
    await failDelay();
    throw new HttpError(401, '管理密碼錯誤');
  }
  setCookie(req, res, ADMIN_COOKIE, makeToken('admin', ADMIN_MAX_AGE), ADMIN_MAX_AGE);
}

export function adminLogout(req, res) {
  setCookie(req, res, ADMIN_COOKIE, '', 0);
}

export function isAdmin(req) {
  return checkToken(parseCookies(req)[ADMIN_COOKIE], 'admin');
}

export function requireAdmin(req) {
  if (!isAdmin(req)) throw new HttpError(401, '請先登入管理者');
}

// ---- 清單 ----
// token 綁定目前的密碼雜湊：修改密碼後，舊的登入狀態自動失效

const listCookieName = (slug) => `sl_list_${slug}`;

export function listLogin(req, res, record) {
  setCookie(req, res, listCookieName(record.slug), makeToken(`list|${record.slug}|${record.hash}`, LIST_MAX_AGE), LIST_MAX_AGE);
}

export function hasListAccess(req, record) {
  if (isAdmin(req)) return true;
  return checkToken(parseCookies(req)[listCookieName(record.slug)], `list|${record.slug}|${record.hash}`);
}
