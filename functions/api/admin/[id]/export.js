// GET /api/admin/:id/export  导出 CSV（需 session，?token= 或 Bearer）
// 带 UTF-8 BOM，Excel 打开中文不乱码。

import { fail } from "../../../_shared/helpers.js";
import { requireAdmin } from "../_guard.js";

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function onRequestGet({ request, env, params }) {
  const g = await requireAdmin(request, env, params.id);
  if (!g.ok) return g.response;

  const rows = await env.DB.prepare(
    `SELECT name, phone, company, remark, checked_in_at, created_at
     FROM signups WHERE event_id = ?
     ORDER BY created_at ASC, id ASC`
  ).bind(g.ev.id).all();

  const lines = ["姓名,手机号,公司,备注,签到状态,签到时间,报名时间"];
  for (const r of rows.results || []) {
    lines.push([
      csvCell(r.name),
      csvCell(r.phone),
      csvCell(r.company || ""),
      csvCell(r.remark || ""),
      r.checked_in_at ? "已签到" : "未签到",
      csvCell(r.checked_in_at || ""),
      csvCell(r.created_at),
    ].join(","));
  }

  const csv = "﻿" + lines.join("\r\n");
  const safeName = encodeURIComponent(`${g.ev.name}-报名名单.csv`);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="signups.csv"; filename*=UTF-8''${safeName}`,
    },
  });
}
