// GET /api/events/:id  活动公开信息 + 剩余名额（不含任何管理字段）

import { json, fail, getEvent } from "../../_shared/helpers.js";

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
