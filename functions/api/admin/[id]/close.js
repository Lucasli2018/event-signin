// POST /api/admin/:id/close  切换报名开关（需 session）
// Body: { closed: true|false }

import { json, fail, readJson } from "../../../_shared/helpers.js";
import { requireAdmin } from "../_guard.js";

export async function onRequestPost({ request, env, params }) {
  const g = await requireAdmin(request, env, params.id);
  if (!g.ok) return g.response;

  const body = await readJson(request);
  const closed = body && body.closed ? 1 : 0;

  await env.DB.prepare("UPDATE events SET closed = ? WHERE id = ?")
    .bind(closed, g.ev.id).run();

  return json({ ok: true, closed: !!closed });
}
