// GET /api/events/:id    活动公开信息（已软删的活动返回 404）
// PUT /api/events/:id    编辑活动（owner 或 admin session）
// DELETE /api/events/:id 软删除活动（owner 或 admin session）

import { json, fail, getEvent, isValidDateTime, nowFullString } from "../../_shared/helpers.js";
import { requireAdmin } from "../admin/_guard.js";

export async function onRequestGet({ env, params }) {
  const ev = await getEvent(env, params.id);
  if (!ev) return fail("活动不存在", 404);

  return json({
    id: ev.id,
    name: ev.name,
    event_time: ev.event_time,
    location: ev.location,
    description: ev.description,
    capacity: ev.capacity,
    taken: ev.taken,
    remaining: Math.max(0, ev.capacity - ev.taken),
    closed: !!ev.closed,
  });
}

export async function onRequestPut({ request, env, params }) {
  const g = await requireAdmin(request, env, params.id);
  if (!g.ok) return g.response;
  const ev = g.ev;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return fail("请求体必须是 JSON");

  const name = body.name !== undefined ? String(body.name).trim() : ev.name;
  const eventTime = body.event_time !== undefined ? String(body.event_time).trim() : ev.event_time;
  const location = body.location !== undefined ? String(body.location ?? "").trim() : (ev.location || "");
  const description = body.description !== undefined ? String(body.description ?? "").trim() : (ev.description || "");
  const capacityRaw = body.capacity !== undefined ? Number(body.capacity) : ev.capacity;
  const archived = body.archived !== undefined ? (body.archived ? 1 : 0) : (ev.archived ? 1 : 0);

  // 报名自定义字段：提供 body.fields 才更新，否则保留原配置
  let fieldsJson = ev.fields;
  if (body.fields !== undefined) {
    if (body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)) {
      try { fieldsJson = JSON.stringify(body.fields); } catch { fieldsJson = ev.fields; }
    } else if (body.fields === null || body.fields === false) {
      fieldsJson = null;
    }
  }

  if (name.length < 2 || name.length > 60) return fail("活动名称需 2-60 字");
  if (!isValidDateTime(eventTime)) return fail("活动时间格式应为 YYYY-MM-DD HH:MM");
  if (!Number.isInteger(capacityRaw) || capacityRaw < 1 || capacityRaw > 100000) {
    return fail("名额需为 1-100000 的整数");
  }
  if (capacityRaw < ev.taken) return fail(`名额不能低于已报名人数（${ev.taken}）`);
  if (location.length > 120) return fail("地点最长 120 字");
  if (description.length > 500) return fail("简介最长 500 字");

  await env.DB.prepare(
    `UPDATE events SET name=?, event_time=?, location=?, description=?, capacity=?, archived=?, fields=? WHERE id=?`
  ).bind(name, eventTime, location || null, description || null, capacityRaw, archived, fieldsJson, ev.id).run();

  let outFields = {};
  try { outFields = fieldsJson ? JSON.parse(fieldsJson) : {}; } catch (_) {}

  return json({
    ok: true,
    event: {
      id: ev.id, name, event_time: eventTime, location: location || null,
      description: description || null, capacity: capacityRaw, taken: ev.taken,
      remaining: Math.max(0, capacityRaw - ev.taken), closed: !!ev.closed, archived: !!archived,
      fields: outFields,
    },
  });
}

export async function onRequestDelete({ request, env, params }) {
  const g = await requireAdmin(request, env, params.id);
  if (!g.ok) return g.response;
  await env.DB.prepare("UPDATE events SET deleted_at = ? WHERE id = ?")
    .bind(nowFullString(), g.ev.id).run();
  return json({ ok: true });
}
