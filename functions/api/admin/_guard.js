// 管理端守卫：活动存在 + 有效 session
// 用法：
//   const g = await requireAdmin(request, env, eventId);
//   if (!g.ok) return g.response;
//   // g.ev, g.session

import { requireSession, getEvent, json } from "../../_shared/helpers.js";

export async function requireAdmin(request, env, eventId) {
  const ev = await getEvent(env, eventId);
  if (!ev) return { ok: false, response: json({ error: "活动不存在" }, 404) };

  const s = await requireSession(env, request, eventId);
  if (s.error) return { ok: false, response: json({ error: s.error }, s.status || 401) };

  return { ok: true, ev, session: s.session, token: s.token };
}
