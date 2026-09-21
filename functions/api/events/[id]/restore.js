// POST /api/events/:id/restore   恢复已软删的活动（清 deleted_at）
// 鉴权：owner 或 admin session（复用 _guard）

import { json } from "../../../_shared/helpers.js";
import { requireAdmin } from "../../admin/_guard.js";

export async function onRequestPost({ request, env, params }) {
  const g = await requireAdmin(request, env, params.id);
  if (!g.ok) return g.response;
  const ev = g.ev;

  if (!ev.deleted_at) {
    return json({ ok: true, restored: false, event: { id: ev.id } });
  }

  await env.DB.prepare("UPDATE events SET deleted_at = NULL WHERE id = ?").bind(ev.id).run();
  return json({ ok: true, restored: true, event: { id: ev.id } });
}
