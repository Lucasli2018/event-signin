// DELETE /api/events/:id/collaborators/:accountId   移除协作者（仅 owner）

import { json, fail, getEventRaw } from "../../../../_shared/helpers.js";
import { requireAccount } from "../../../../_shared/account.js";

export async function onRequestDelete({ request, env, params }) {
  const ev = await getEventRaw(env, params.id);
  if (!ev) return fail("活动不存在", 404);
  const a = await requireAccount(request, env);
  if (a.error) return fail(a.error, a.status);
  if (a.account.id !== ev.owner_id) return fail("仅活动创建者可移除协作者", 403);

  const targetId = params.accountId;
  if (targetId === ev.owner_id) return fail("不能移除活动创建者", 400);

  await env.DB.prepare(
    "DELETE FROM event_collaborators WHERE event_id = ? AND account_id = ?"
  ).bind(ev.id, targetId).run();

  return json({ ok: true });
}
