// GET /api/admin/:id/signups  报名名单（需 session）
// 返回: { event, signups: [...] }

import { json } from "../../../_shared/helpers.js";
import { requireAdmin } from "../_guard.js";

export async function onRequestGet({ request, env, params }) {
  const g = await requireAdmin(request, env, params.id);
  if (!g.ok) return g.response;

  const rows = await env.DB.prepare(
    `SELECT id, name, phone, company, remark, checked_in_at, created_at
     FROM signups WHERE event_id = ?
     ORDER BY created_at ASC, id ASC`
  ).bind(g.ev.id).all();

  const list = rows.results || [];
  const checkedCount = list.filter(r => r.checked_in_at).length;

  // 签到按时段分布（按小时分桶 'YYYY-MM-DD HH'）
  const dist = {};
  for (const r of list) {
    if (r.checked_in_at) {
      const bucket = String(r.checked_in_at).slice(0, 13);
      dist[bucket] = (dist[bucket] || 0) + 1;
    }
  }
  const checkin_distribution = Object.keys(dist).sort().map(b => ({ bucket: b, count: dist[b] }));

  return json({
    event: {
      id: g.ev.id,
      name: g.ev.name,
      event_time: g.ev.event_time,
      location: g.ev.location,
      capacity: g.ev.capacity,
      taken: g.ev.taken,
      closed: !!g.ev.closed,
      archived: !!g.ev.archived,
    },
    signups: list,
    stats: { total: list.length, checked: checkedCount, unchecked: list.length - checkedCount, checkin_distribution },
  });
}
