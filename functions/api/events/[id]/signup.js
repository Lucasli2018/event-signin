// POST /api/events/:id/signup  报名
// Body: { name, phone }
// 返回: { token, name }（token 即签到码内容，请报名者保存）
//
// 名额并发安全：先条件 UPDATE 占位（taken < capacity），失败即满员；
// 插 signup 撞 UNIQUE(event_id, phone) 时回退占位。

import { genToken } from "../../../_shared/crypto.js";
import { json, fail, readJson, getEvent, isValidPhone } from "../../../_shared/helpers.js";

export async function onRequestPost({ request, env, params }) {
  const ev = await getEvent(env, params.id);
  if (!ev) return fail("活动不存在", 404);
  if (ev.closed) return fail("报名已截止", 410);

  const body = await readJson(request);
  if (!body) return fail("请求体必须是 JSON");

  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();

  if (name.length < 1 || name.length > 30) return fail("姓名需 1-30 字");
  if (!isValidPhone(phone)) return fail("手机号格式不正确");

  // 重复报名快速提示（最终防线仍是 UNIQUE 约束）
  const dup = await env.DB.prepare(
    "SELECT token, name FROM signups WHERE event_id = ? AND phone = ?"
  ).bind(ev.id, phone).first();
  if (dup) {
    // 幂等：同一人重复提交直接返回原签到码，方便找回
    return json({ token: dup.token, name: dup.name, duplicated: true });
  }

  // 条件占位：并发下不会超卖
  const hold = await env.DB.prepare(
    "UPDATE events SET taken = taken + 1 WHERE id = ? AND taken < capacity AND closed = 0"
  ).bind(ev.id).run();
  if (!hold.meta.changes) return fail("名额已满", 410);

  const token = genToken(16);
  try {
    await env.DB.prepare(
      "INSERT INTO signups (event_id, name, phone, token) VALUES (?, ?, ?, ?)"
    ).bind(ev.id, name, phone, token).run();
  } catch (err) {
    // 回退占位
    await env.DB.prepare(
      "UPDATE events SET taken = MAX(taken - 1, 0) WHERE id = ?"
    ).bind(ev.id).run();
    if (String(err).includes("UNIQUE")) {
      const again = await env.DB.prepare(
        "SELECT token, name FROM signups WHERE event_id = ? AND phone = ?"
      ).bind(ev.id, phone).first();
      if (again) return json({ token: again.token, name: again.name, duplicated: true });
      return fail("该手机号已报名", 409);
    }
    throw err;
  }

  return json({ token, name }, 201);
}
