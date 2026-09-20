// POST /api/admin/:id/uncheck  取消签到（需 session）
// Body: { signup_id }

import { json, fail, readJson } from "../../../_shared/helpers.js";
import { requireAdmin } from "../_guard.js";

export async function onRequestPost({ request, env, params }) {
  const g = await requireAdmin(request, env, params.id);
  if (!g.ok) return g.response;

  const body = await readJson(request);
  const signupId = body ? Number(body.signup_id) : 0;
  if (!Number.isInteger(signupId) || signupId <= 0) return fail("缺少 signup_id");

  const r = await env.DB.prepare(
    "UPDATE signups SET checked_in_at = NULL WHERE id = ? AND event_id = ?"
  ).bind(signupId, g.ev.id).run();

  if (!r.meta.changes) return fail("记录不存在", 404);
  return json({ ok: true });
}
