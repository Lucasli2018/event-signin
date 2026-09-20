// POST /api/events  创建活动
// Body: { name, event_time: 'YYYY-MM-DD HH:MM', location?, description?, capacity, pin }
// 返回: { id, admin_key, signup_path, manage_path }

import { hashPassword, genSalt, genToken } from "../_shared/crypto.js";
import { json, fail, readJson, isValidDateTime } from "../_shared/helpers.js";

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return fail("请求体必须是 JSON");

  const name = String(body.name || "").trim();
  const eventTime = String(body.event_time || "").trim();
  const location = String(body.location || "").trim();
  const description = String(body.description || "").trim();
  const capacity = Number(body.capacity);
  const pin = String(body.pin || "");

  if (name.length < 2 || name.length > 60) return fail("活动名称需 2-60 字");
  if (!isValidDateTime(eventTime)) return fail("活动时间格式应为 YYYY-MM-DD HH:MM");
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) {
    return fail("名额需为 1-100000 的整数");
  }
  if (!/^\d{6,8}$/.test(pin)) return fail("PIN 需为 6-8 位数字");
  if (location.length > 120) return fail("地点最长 120 字");
  if (description.length > 500) return fail("简介最长 500 字");

  const id = genToken(5);        // 10 位 hex，分享链接用
  const adminKey = genToken(16); // 管理链接密钥
  const pinSalt = genSalt(16);
  const pinHash = await hashPassword(pin, pinSalt);

  await env.DB.prepare(
    `INSERT INTO events (id, name, event_time, location, description, capacity, admin_key, pin_hash, pin_salt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, name, eventTime, location || null, description || null, capacity, adminKey, pinHash, pinSalt).run();

  return json({
    id,
    admin_key: adminKey,
    signup_path: `/e.html?id=${id}`,
    manage_path: `/manage.html?id=${id}&key=${adminKey}`,
  }, 201);
}
