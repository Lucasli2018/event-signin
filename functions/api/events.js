// POST /api/events  创建活动
// Body: { name, event_time: 'YYYY-MM-DD HH:MM', location?, description?, capacity, pin }
// 返回: { id, admin_key, signup_path, manage_path }

import { hashPassword, genSalt, genToken } from "../_shared/crypto.js";
import { json, fail, readJson, isValidDateTime } from "../_shared/helpers.js";
import { parseCookies, requireAccount, COOKIE } from "../_shared/account.js";

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return fail("请求体必须是 JSON");

  const name = String(body.name || "").trim();
  const eventTime = String(body.event_time || "").trim();
  const location = String(body.location || "").trim();
  const description = String(body.description || "").trim();
  const capacity = Number(body.capacity);
  const pin = String(body.pin || "");

  // 账号登录态（Cookie）→ 绑定 owner，PIN 可留空（自动生成隐藏 PIN 作兜底）
  const token = parseCookies(request)[COOKIE];
  let ownerId = null;
  if (token) {
    const a = await requireAccount(request, env);
    if (a.account) ownerId = a.account.id;
  }

  if (name.length < 2 || name.length > 60) return fail("活动名称需 2-60 字");
  if (!isValidDateTime(eventTime)) return fail("活动时间格式应为 YYYY-MM-DD HH:MM");
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) {
    return fail("名额需为 1-100000 的整数");
  }
  // PIN 规则：无账号时必须 6-8 位；有账号时可留空（自动隐藏 PIN 兜底）
  let realPin = pin;
  if (pin && !/^\d{6,8}$/.test(pin)) return fail("PIN 需为 6-8 位数字");
  if (!ownerId) {
    if (!/^\d{6,8}$/.test(pin)) return fail("PIN 需为 6-8 位数字");
  } else if (!pin) {
    realPin = String(Math.floor(10000000 + Math.random() * 90000000)); // 8 位隐藏 PIN（兜底用）
  }
  if (location.length > 120) return fail("地点最长 120 字");
  if (description.length > 500) return fail("简介最长 500 字");

  const id = genToken(5);        // 10 位 hex，分享链接用
  const adminKey = genToken(16); // 管理链接密钥
  const pinSalt = genSalt(16);
  const pinHash = await hashPassword(realPin, pinSalt);

  await env.DB.prepare(
    `INSERT INTO events (id, name, event_time, location, description, capacity, admin_key, pin_hash, pin_salt, owner_id, fields)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, name, eventTime, location || null, description || null, capacity, adminKey, pinHash, pinSalt, ownerId, fieldsJson).run();

  return json({
    id,
    admin_key: adminKey,
    owner: !!ownerId,
    fields: fieldsObj,
    signup_path: `/e.html?id=${id}`,
    manage_path: ownerId ? `/manage.html?id=${id}` : `/manage.html?id=${id}&key=${adminKey}`,
  }, 201);
}
