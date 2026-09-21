// POST /api/account/register  邮箱+密码注册 → 自动登录
// Body: { email, password, displayName? }
// 返回: { ok, account } + Set-Cookie(es_acct)

import { json, fail, readJson } from "../../_shared/helpers.js";
import {
  registerAccount, createSession, isHttps, underLimit, clientIp, attachSession,
} from "../../_shared/account.js";

function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return fail("请求体必须是 JSON");

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const displayName = String(body.displayName || "").trim();

  if (!validEmail(email)) return fail("邮箱格式不正确");
  if (password.length < 8) return fail("密码至少 8 位");
  if (displayName.length > 40) return fail("昵称最长 40 字");
  if (!underLimit("reg:" + clientIp(request))) return fail("操作过于频繁，请稍后再试", 429);

  let id;
  try {
    id = await registerAccount(env, email, password, displayName);
  } catch (e) {
    if (/UNIQUE|unique/i.test(e.message || "")) return fail("该邮箱已注册", 409);
    throw e;
  }

  const s = await createSession(env, id);
  const res = json({ ok: true, account: { id, email, displayName: displayName || null } }, 201);
  return attachSession(res, s.token, s.expiresISO, isHttps(request));
}
