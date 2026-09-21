// 账号系统共享：Cookie 会话、账号校验、注册/登录/登出逻辑
// 登录态用 httpOnly Cookie（es_acct）保存，防 XSS 窃取 token。

import { hashPassword, verifyPassword, genSalt, genToken } from "./crypto.js";
import { json, fail, readJson, nowFullString } from "./helpers.js";

export const COOKIE = "es_acct";
export const SESSION_TTL_DAYS = 30;

// ============ Cookie 工具 ============
export function parseCookies(request) {
  const h = request.headers.get("cookie") || "";
  const out = {};
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "local";
}

export function isHttps(request) {
  try { return new URL(request.url).protocol === "https:"; } catch { return false; }
}

// 设置会话 Cookie：本地(http)不加 Secure 便于开发，生产(https)加 Secure
export function sessionCookie(token, expiresAtISO, secure) {
  const parts = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  parts.push(`Expires=${new Date(expiresAtISO).toUTCString()}`);
  return parts.join("; ");
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// 'YYYY-MM-DD HH:MM:SS'（Asia/Shanghai），与 nowFullString 同格式可字典序比较
function formatLocalFull(d, tz = "Asia/Shanghai") {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const g = t => p.find(x => x.type === t)?.value || "00";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}:${g("second")}`;
}

// ============ 内存 rate-limit ============
const buckets = new Map();
const WINDOW = 15 * 60 * 1000;
// 返回 true 表示仍在限额内（并记一次命中）
export function underLimit(key, max = 20, window = WINDOW) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter(t => now - t < window);
  arr.push(now);
  buckets.set(key, arr);
  return arr.length <= max;
}

// ============ 账号会话校验（从 Cookie 读取）============
export async function requireAccount(request, env) {
  const token = parseCookies(request)[COOKIE];
  if (!token) return { error: "未登录", status: 401 };

  const session = await env.DB.prepare(
    "SELECT * FROM account_sessions WHERE token = ?"
  ).bind(token).first();
  if (!session) return { error: "会话无效", status: 401 };

  const now = nowFullString();
  if (session.expires_at < now) {
    await env.DB.prepare("DELETE FROM account_sessions WHERE token = ?").bind(token).run();
    return { error: "会话已过期", status: 401 };
  }

  const account = await env.DB.prepare(
    "SELECT id, email, display_name FROM accounts WHERE id = ?"
  ).bind(session.account_id).first();
  if (!account) return { error: "账号不存在", status: 401 };

  return { session, account, token };
}

// ============ 注册 ============
export async function registerAccount(env, email, password, displayName) {
  const id = genToken(8);
  const salt = genSalt(16);
  const pwHash = await hashPassword(password, salt);
  await env.DB.prepare(
    `INSERT INTO accounts (id, email, display_name, pw_hash, pw_salt, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, email, displayName || null, pwHash, salt, nowFullString()).run();
  return id;
}

// ============ 登录 ============
export async function loginAccount(env, email, password) {
  const account = await env.DB.prepare(
    "SELECT * FROM accounts WHERE email = ?"
  ).bind(email).first();
  if (!account) return null;
  const ok = await verifyPassword(password, account.pw_salt, account.pw_hash);
  if (!ok) return null;
  return account;
}

// ============ 创建会话（写入 D1 + 返回 Cookie 参数）============
export async function createSession(env, accountId) {
  const token = genToken(32);
  const now = nowFullString();
  const expiresISO = new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const expiresLocal = formatLocalFull(new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000));

  await env.DB.prepare(
    "INSERT INTO account_sessions (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(token, accountId, now, expiresLocal).run();

  // 顺手清理过期会话
  await env.DB.prepare("DELETE FROM account_sessions WHERE expires_at < ?").bind(now).run();

  return { token, expiresISO };
}

// 统一：把会话 Cookie 挂到响应上
export function attachSession(res, token, expiresISO, secure) {
  res.headers.append("Set-Cookie", sessionCookie(token, expiresISO, secure));
  return res;
}
