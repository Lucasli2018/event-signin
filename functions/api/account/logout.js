// POST /api/account/logout  登出（销毁服务端会话 + 清 Cookie）

import { json } from "../../_shared/helpers.js";
import { parseCookies, clearCookie, COOKIE } from "../../_shared/account.js";

export async function onRequestPost({ request, env }) {
  const token = parseCookies(request)[COOKIE];
  if (token) {
    await env.DB.prepare("DELETE FROM account_sessions WHERE token = ?").bind(token).run();
  }
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", clearCookie());
  return res;
}
