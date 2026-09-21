// POST /api/account/login  邮箱+密码登录
// Body: { email, password }
// 返回: { ok, account } + Set-Cookie(es_acct)

import { json, fail, readJson } from "../../_shared/helpers.js";
import {
  loginAccount, createSession, isHttps, underLimit, clientIp, attachSession,
} from "../../_shared/account.js";

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return fail("请求体必须是 JSON");

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!underLimit("login:" + clientIp(request))) return fail("尝试次数过多，请 15 分钟后重试", 429);

  const account = await loginAccount(env, email, password);
  if (!account) return fail("邮箱或密码错误", 401);

  const s = await createSession(env, account.id);
  const res = json({
    ok: true,
    account: { id: account.id, email: account.email, displayName: account.display_name },
  });
  return attachSession(res, s.token, s.expiresISO, isHttps(request));
}
