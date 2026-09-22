// POST /api/admin/:id/auth  PIN 登录
// Body: { key: "<admin_key>", pin: "123456" }
// 返回: { token, event: {...}, expiresIn }
// key + PIN 双因子：管理链接（key）+ 创建时设的 PIN。
// 内存 rate-limit：同活动 15 分钟最多 20 次尝试。

import { verifyPassword, genToken } from "../../../_shared/crypto.js";
import { json, fail, readJson, getEvent, nowLocalString } from "../../../_shared/helpers.js";

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;

function checkRateLimit(id) {
  const now = Date.now();
  const list = (attempts.get(id) || []).filter(e => now - e.t < WINDOW_MS);
  attempts.set(id, list);
  return list.length < MAX_ATTEMPTS;
}

function recordAttempt(id) {
  const now = Date.now();
  const list = (attempts.get(id) || []).filter(e => now - e.t < WINDOW_MS);
  list.push({ t: now });
  attempts.set(id, list);
}

export async function onRequestPost({ request, env, params }) {
  const ev = await getEvent(env, params.id);
  if (!ev) return fail("活动不存在", 404);

  if (!checkRateLimit(ev.id)) return fail("尝试次数过多，请 15 分钟后重试", 429);

  const body = await readJson(request);
  const key = body ? String(body.key || "") : "";
  const pin = body ? String(body.pin || "") : "";

  if (key !== ev.admin_key) {
    recordAttempt(ev.id);
    return fail("管理链接无效", 403);
  }
  if (!(await verifyPassword(pin, ev.pin_salt, ev.pin_hash))) {
    recordAttempt(ev.id);
    return fail("PIN 错误", 401);
  }

  const token = genToken(32);
  const now = nowLocalString();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const expiresStr = expires.toISOString().slice(0, 19).replace("T", " ");

  await env.DB.prepare(
    "INSERT INTO admin_sessions (token, event_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(token, ev.id, now, expiresStr).run();

  // 顺手清理过期 session
  await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(now).run();

  return json({
    token,
    event: {
      id: ev.id,
      name: ev.name,
      event_time: ev.event_time,
      location: ev.location,
      capacity: ev.capacity,
      taken: ev.taken,
      closed: !!ev.closed,
      listed: !!ev.listed,
    },
    expiresIn: 86400,
  });
}
