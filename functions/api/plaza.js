// GET /api/plaza  活动广场：所有人可见的公开活动列表（无需登录）
// 查询参数：
//   q        关键词（匹配 name / location / description）
//   status   upcoming | past | all（默认 all）
//   hasSpots 1 = 仅看有剩余名额且未截止
//   sort     time_asc | time_desc | newest（默认 time_asc）
//   limit    每页条数（默认 20，最多 100）
//   offset   偏移（默认 0）
// 返回：{ events: [...], total }
// 仅暴露公开字段，绝不返回 admin_key / pin / owner_id 等敏感信息。

import { json, fail, nowLocalString } from "../_shared/helpers.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sp = url.searchParams;

  const q = (sp.get("q") || "").trim();
  const status = (sp.get("status") || "all").trim();
  const hasSpots = sp.get("hasSpots") === "1";
  const sort = (sp.get("sort") || "time_asc").trim();

  // 分页参数收敛，防止恶意超大值
  let limit = Number(sp.get("limit"));
  if (!Number.isInteger(limit) || limit < 1) limit = 20;
  limit = Math.min(limit, 100);
  let offset = Number(sp.get("offset"));
  if (!Number.isInteger(offset) || offset < 0) offset = 0;
  offset = Math.min(offset, 10000);

  const now = nowLocalString(); // 'YYYY-MM-DD HH:MM'（Asia/Shanghai，与 event_time 同格式可字典序比较）

  // 基础可见性：未删除、未归档、在广场公开
  const where = ["e.deleted_at IS NULL", "e.archived = 0", "e.listed = 1"];
  const binds = [];

  if (q) {
    where.push("(e.name LIKE ? OR e.location LIKE ? OR e.description LIKE ?)");
    const like = `%${q}%`;
    binds.push(like, like, like);
  }
  if (status === "upcoming") {
    where.push("e.event_time >= ?");
    binds.push(now);
  } else if (status === "past") {
    where.push("e.event_time < ?");
    binds.push(now);
  }
  if (hasSpots) {
    where.push("e.taken < e.capacity AND e.closed = 0");
  }

  let orderBy;
  if (sort === "time_desc") orderBy = "e.event_time DESC";
  else if (sort === "newest") orderBy = "e.created_at DESC";
  else orderBy = "e.event_time ASC";

  const whereSql = where.join(" AND ");

  // 总数（与列表同 WHERE，便于前端做「加载更多」与计数）
  let total = 0;
  try {
    const c = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM events e WHERE ${whereSql}`
    ).bind(...binds).first();
    total = (c && c.c) || 0;
  } catch (e) {
    console.error("[plaza] 计数失败:", e);
    return fail("查询失败", 500);
  }

  // 列表：只选公开字段，LEFT JOIN 组织者昵称
  const rows = await env.DB.prepare(
    `SELECT e.id, e.name, e.event_time, e.location, e.description,
            e.capacity, e.taken, e.closed, e.created_at, a.display_name AS organizer
     FROM events e
     LEFT JOIN accounts a ON e.owner_id = a.id
     WHERE ${whereSql}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();

  const events = (rows.results || []).map(r => {
    const capacity = r.capacity || 0;
    const taken = r.taken || 0;
    return {
      id: r.id,
      name: r.name,
      event_time: r.event_time,
      location: r.location || "",
      description: r.description || "",
      capacity,
      taken,
      remaining: Math.max(0, capacity - taken),
      closed: !!r.closed,
      created_at: r.created_at,
      organizer: r.organizer || "匿名组织者",
    };
  });

  return json({ events, total, limit, offset });
}
