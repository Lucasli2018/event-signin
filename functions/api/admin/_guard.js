// 管理端守卫：活动存在 + 有效会话
// 两种进入方式（任一即可）：
//   1) 旧模式：admin_key + PIN 换取的 Bearer session（token 在 URL/Header）
//   2) 账号模式：登录账号的 Cookie 会话，且 account.id === events.owner_id
// 用法：
//   const g = await requireAdmin(request, env, eventId);
//   if (!g.ok) return g.response;
//   // g.ev, g.via ('session' | 'account')

import { requireSession, getEventRaw, json } from "../../_shared/helpers.js";
import { requireAccount } from "../../_shared/account.js";

export async function requireAdmin(request, env, eventId) {
  const ev = await getEventRaw(env, eventId);
  if (!ev) return { ok: false, response: json({ error: "活动不存在" }, 404) };

  // 1) 旧模式：Bearer admin session
  const s = await requireSession(env, request, eventId);
  if (!s.error) {
    return { ok: true, ev, session: s.session, token: s.token, via: "session" };
  }

  // 2) 账号模式：登录态且是活动 owner
  const a = await requireAccount(request, env);
  if (a.account) {
    if (a.account.id === ev.owner_id) {
      return { ok: true, ev, session: null, token: null, via: "account", account: a.account };
    }
    return { ok: false, response: json({ error: "无权限管理此活动" }, 403) };
  }

  // 既无 session 也无账号登录
  return { ok: false, response: json({ error: s.error || "未登录" }, s.status || 401) };
}
