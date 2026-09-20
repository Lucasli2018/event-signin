// POST /api/admin/:id/checkin  签到（需 session）
// Body 二选一：
//   { token: "<签到码>" }      —— 扫码路径
//   { phone: "<手机号>" }      —— 手动补签路径
// 幂等：已签到返回 already_checked + 原签到时间，不报错。

import { json, fail, readJson, nowFullString } from "../../../_shared/helpers.js";
import { requireAdmin } from "../_guard.js";

export async function onRequestPost({ request, env, params }) {
  const g = await requireAdmin(request, env, params.id);
  if (!g.ok) return g.response;

  const body = await readJson(request);
  if (!body) return fail("请求体必须是 JSON");

  let signup = null;
  const token = String(body.token || "").trim();
  const phone = String(body.phone || "").trim();

  if (token) {
    // 二维码内容兼容：直接是 token，或 JSON {"t":"<token>"}
    let t = token;
    if (t.startsWith("{")) {
      try { t = JSON.parse(t).t || t; } catch { /* 原样使用 */ }
    }
    signup = await env.DB.prepare(
      "SELECT * FROM signups WHERE event_id = ? AND token = ?"
    ).bind(g.ev.id, t).first();
  } else if (phone) {
    signup = await env.DB.prepare(
      "SELECT * FROM signups WHERE event_id = ? AND phone = ?"
    ).bind(g.ev.id, phone).first();
  } else {
    return fail("缺少 token 或 phone");
  }

  if (!signup) return fail("未找到该报名记录", 404);

  if (signup.checked_in_at) {
    return json({ ok: true, already_checked: true, name: signup.name, checked_in_at: signup.checked_in_at });
  }

  const now = nowFullString();
  await env.DB.prepare(
    "UPDATE signups SET checked_in_at = ? WHERE id = ? AND checked_in_at IS NULL"
  ).bind(now, signup.id).run();

  return json({ ok: true, already_checked: false, name: signup.name, checked_in_at: now });
}
