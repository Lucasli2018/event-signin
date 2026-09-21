// GET /api/account/events  当前账号拥有的活动列表（最新在前）
//   ?scope=trash → 仅返回已软删的活动（回收站）；否则返回活跃活动

import { json, fail } from "../../_shared/helpers.js";
import { requireAccount } from "../../_shared/account.js";

export async function onRequestGet({ request, env }) {
  const a = await requireAccount(request, env);
  if (a.error) return fail(a.error, a.status);

  const url = new URL(request.url);
  const trash = url.searchParams.get("scope") === "trash";
  const where = trash
    ? "owner_id = ? AND deleted_at IS NOT NULL"
    : "owner_id = ? AND deleted_at IS NULL";

  const rows = await env.DB.prepare(
    `SELECT id, name, event_time, location, capacity, taken, closed, archived, deleted_at, created_at
     FROM events WHERE ${where}
     ORDER BY ${trash ? "deleted_at DESC" : "created_at DESC"}, id DESC`
  ).bind(a.account.id).all();

  return json({ ok: true, events: rows.results || [] });
}
