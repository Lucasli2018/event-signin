// GET  /api/events/:id/collaborators   列表（owner 或协作者可见）
// POST /api/events/:id/collaborators   邀请（仅 owner，按邮箱）

import { json, fail, getEventRaw } from "../../../_shared/helpers.js";
import { requireAccount } from "../../../_shared/account.js";

export async function onRequestGet({ request, env, params }) {
  const ev = await getEventRaw(env, params.id);
  if (!ev) return fail("活动不存在", 404);
  const a = await requireAccount(request, env);
  if (a.error) return fail(a.error, a.status);

  const isOwner = a.account.id === ev.owner_id;
  if (!isOwner) {
    const col = await env.DB.prepare(
      "SELECT 1 FROM event_collaborators WHERE event_id = ? AND account_id = ?"
    ).bind(ev.id, a.account.id).first();
    if (!col) return fail("无权限查看", 403);
  }

  const rows = await env.DB.prepare(
    `SELECT c.account_id, c.role, c.created_at, a.email, a.display_name
     FROM event_collaborators c JOIN accounts a ON a.id = c.account_id
     WHERE c.event_id = ? ORDER BY c.created_at ASC`
  ).bind(ev.id).all();

  return json({ ok: true, isOwner, collaborators: rows.results || [] });
}

export async function onRequestPost({ request, env, params }) {
  const ev = await getEventRaw(env, params.id);
  if (!ev) return fail("活动不存在", 404);
  const a = await requireAccount(request, env);
  if (a.error) return fail(a.error, a.status);
  if (a.account.id !== ev.owner_id) return fail("仅活动创建者可邀请协作者", 403);

  const body = await request.json().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("邮箱格式不正确");

  const target = await env.DB.prepare("SELECT id, email, display_name FROM accounts WHERE email = ?")
    .bind(email).first();
  if (!target) return fail("该邮箱尚未注册账号，无法邀请", 404);
  if (target.id === ev.owner_id) return fail("不能邀请活动创建者本人", 400);

  const exist = await env.DB.prepare(
    "SELECT 1 FROM event_collaborators WHERE event_id = ? AND account_id = ?"
  ).bind(ev.id, target.id).first();
  if (exist) {
    return json({ ok: true, already: true, collaborator: { account_id: target.id, email: target.email, display_name: target.display_name, role: "editor" } });
  }

  await env.DB.prepare(
    "INSERT INTO event_collaborators (event_id, account_id, role) VALUES (?, ?, 'editor')"
  ).bind(ev.id, target.id).run();

  return json({ ok: true, collaborator: { account_id: target.id, email: target.email, display_name: target.display_name, role: "editor" } }, 201);
}
