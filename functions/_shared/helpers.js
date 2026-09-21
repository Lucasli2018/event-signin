// 共享工具：JSON 响应、请求解析、session 校验、时间工具

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function fail(message, status = 400) {
  return json({ error: message }, status);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// ============ 活动查询 ============
export async function getEvent(env, eventId) {
  if (!eventId || typeof eventId !== "string") return null;
  return env.DB.prepare("SELECT * FROM events WHERE id = ? AND deleted_at IS NULL").bind(eventId).first();
}

// 不过滤软删除，供管理端查看/恢复已删活动
export async function getEventRaw(env, eventId) {
  if (!eventId || typeof eventId !== "string") return null;
  return env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first();
}

// ============ Session 校验 ============
export function extractToken(request) {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return fromQuery;
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

export async function requireSession(env, request, eventId) {
  const token = extractToken(request);
  if (!token) return { error: "未登录", status: 401 };

  const session = await env.DB.prepare(
    "SELECT * FROM admin_sessions WHERE token = ?"
  ).bind(token).first();

  if (!session) return { error: "会话无效", status: 401 };

  const now = nowLocalString();
  if (session.expires_at < now) {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE token = ?").bind(token).run();
    return { error: "会话已过期", status: 401 };
  }

  if (session.event_id !== eventId) {
    return { error: "会话与活动不匹配", status: 403 };
  }

  return { session, token };
}

// ============ 时间工具 ============
// 统一 'YYYY-MM-DD HH:MM'（naive 本地时间，默认 Asia/Shanghai）
export function nowLocalString(tz = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function nowFullString(tz = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

// 校验 'YYYY-MM-DD HH:MM' 格式
export function isValidDateTime(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s);
}

// 手机号：宽松校验，6-20 位数字（可含 + - 空格），够用即可
export function isValidPhone(s) {
  return typeof s === "string" && /^[+\d][\d\s-]{5,19}$/.test(s.trim());
}
