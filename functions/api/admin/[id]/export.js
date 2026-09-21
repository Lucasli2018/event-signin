// GET /api/admin/:id/export  导出 CSV（需 session，?token= 或 Bearer）
// 带 UTF-8 BOM，Excel 打开中文不乱码。

import { fail, parseEventFields } from "../../../_shared/helpers.js";
import { requireAdmin } from "../_guard.js";

function csvCell(v) {
  let s = v == null ? "" : String(v);
  // 防 CSV 公式注入：Excel 会把 = + - @ 开头的单元格当公式执行（DDE 风险）
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
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

  // 列随活动启用的自定义字段增减，避免导出整列空白
  const fieldsDef = parseEventFields(g.ev.fields);
  const cols = ["姓名", "手机号"];
  if (fieldsDef.company) cols.push("公司");
  if (fieldsDef.remark) cols.push("备注");
  cols.push("签到状态", "签到时间", "报名时间");

  const lines = [cols.join(",")];
  for (const r of rows.results || []) {
    const cells = [csvCell(r.name), csvCell(r.phone)];
    if (fieldsDef.company) cells.push(csvCell(r.company || ""));
    if (fieldsDef.remark) cells.push(csvCell(r.remark || ""));
    cells.push(r.checked_in_at ? "已签到" : "未签到", csvCell(r.checked_in_at || ""), csvCell(r.created_at));
    lines.push(cells.join(","));
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
