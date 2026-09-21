// GET /api/account/me  返回当前登录账号信息（无登录返回 401）

import { json, fail } from "../../_shared/helpers.js";
import { requireAccount } from "../../_shared/account.js";

export async function onRequestGet({ request, env }) {
  const a = await requireAccount(request, env);
  if (a.error) return fail(a.error, a.status);
  return json({
    ok: true,
    account: { id: a.account.id, email: a.account.email, displayName: a.account.display_name },
  });
}
