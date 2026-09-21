// GET /api/account/events  当前账号拥有的活动列表（最新在前）

import { json, fail } from "../../_shared/helpers.js";
import { requireAccount } from "../../_shared/account.js";

export async function onRequestGet({ request, env }) {
  const a = await requireAccount(request, env);
  if (a.error) return fail(a.error, a.status);

  const rows = await env.DB.prepare(
    `SELECT id, name, event_time, location, capacity, taken, closed, created_at
     FROM events WHERE owner_id = ?
     ORDER BY created_at DESC, id DESC`
  ).bind(a.account.id).all();

  return json({ ok: true, events: rows.results || [] });
}
