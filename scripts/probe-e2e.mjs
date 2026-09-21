// 端到端探针：真实 HTTP 打通「创建活动 → 报名 → PIN 登录 → 扫码签到 → 撤销 → 导出 → 截止」
// 用法：
//   node scripts/probe-e2e.mjs                          # 打线上 https://event-signin.pages.dev
//   BASE=http://localhost:8788 node scripts/probe-e2e.mjs
//   TOKEN_FILE=.tmp-token node scripts/probe-e2e.mjs     # 附带清理测试数据（需 D1 编辑权限）
//
// 退出码非 0 表示有用例失败。
const BASE = (process.env.BASE || "https://event-signin.pages.dev").replace(/\/$/, "");
const ACCT = process.env.CLOUDFLARE_ACCOUNT_ID || "332b848d9f5d9ec2808bdb855763eb8e";

// 本机无 IPv6 出口，而 *.pages.dev 同时返回 AAAA/A 记录 → undici 优先 IPv6 会连接超时。
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const TIMEOUT_MS = Number(process.env.REQ_TIMEOUT_MS || 30000);

let pass = 0, fail = 0;
const fails = [];
function ck(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name} ${extra}`); }
}

async function req(method, path, body, headers = {}) {
  const opts = {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
  let r;
  for (let i = 0; i < 3; i++) {
    try { r = await fetch(`${BASE}${path}`, opts); break; }
    catch (e) { if (i === 2) throw e; await new Promise(s => setTimeout(s, 1000 * (i + 1))); }
  }
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON（CSV 等） */ }
  return { status: r.status, json, text, headers: r.headers };
}

const stamp = Date.now().toString(36);
const NAME = `[E2E] 探针活动 ${stamp}`;
const PIN = "246813";

console.log(`base: ${BASE}`);
let eventId = null;

// ---------- 1. 不存在的活动 → 404 ----------
console.log("\n[1] 404 与 Functions 生效");
{
  const r = await req("GET", "/api/events/deadbeef00");
  ck("未知活动返回 404", r.status === 404, `got ${r.status}`);
}

// ---------- 2. 创建活动 ----------
console.log("\n[2] 创建活动");
{
  const r = await req("POST", "/api/events", {
    name: NAME, event_time: "2026-10-01 14:30", location: "深圳南山",
    description: "端到端探针", capacity: 2, pin: PIN,
  });
  ck("创建返回 201", r.status === 201, `got ${r.status} ${r.text.slice(0, 120)}`);
  const d = r.json || {};
  ck("返回 10 位 hex id", /^[0-9a-f]{10}$/.test(d.id || ""), d.id);
  ck("返回 32 位 admin_key", /^[0-9a-f]{32}$/.test(d.admin_key || ""), d.admin_key);
  ck("signup_path 正确", d.signup_path === `/e.html?id=${d.id}`);
  eventId = d.id;
  globalThis.__key = d.admin_key;
}
if (!eventId) { console.log("\n创建失败，后续跳过"); process.exit(1); }

// ---------- 3. 参数校验 ----------
console.log("\n[3] 创建参数校验");
{
  const bad = await req("POST", "/api/events", { name: "x", event_time: "2026-10-01 14:30", capacity: 5, pin: "123456" });
  ck("名称过短被拒", bad.status === 400, `got ${bad.status}`);
  const bad2 = await req("POST", "/api/events", { name: "探针活动", event_time: "2026/10/01", capacity: 5, pin: "123456" });
  ck("时间格式非法被拒", bad2.status === 400, `got ${bad2.status}`);
  const bad3 = await req("POST", "/api/events", { name: "探针活动", event_time: "2026-10-01 14:30", capacity: 5, pin: "12" });
  ck("PIN 位数非法被拒", bad3.status === 400, `got ${bad3.status}`);
}

// ---------- 4. 公开信息 ----------
console.log("\n[4] 活动公开信息");
{
  const r = await req("GET", `/api/events/${eventId}`);
  ck("返回 200", r.status === 200, `got ${r.status}`);
  ck("remaining = capacity", r.json?.remaining === 2, JSON.stringify(r.json));
  ck("不泄露 admin_key", !("admin_key" in (r.json || {})), Object.keys(r.json || {}).join(","));
  ck("不泄露 pin_hash", !("pin_hash" in (r.json || {})));
}

// ---------- 5. 报名 ----------
console.log("\n[5] 报名");
let signupToken = null, signupId = null;
{
  const r = await req("POST", `/api/events/${eventId}/signup`, { name: "张三", phone: "13800001111" });
  ck("首次报名 201", r.status === 201, `got ${r.status} ${r.text.slice(0, 120)}`);
  ck("返回 32 位签到 token", /^[0-9a-f]{32}$/.test(r.json?.token || ""), r.json?.token);
  signupToken = r.json?.token;

  const dup = await req("POST", `/api/events/${eventId}/signup`, { name: "张三", phone: "13800001111" });
  ck("同号重复报名幂等返回原码", dup.status === 200 && dup.json?.duplicated === true && dup.json?.token === signupToken,
    `got ${dup.status} ${dup.text.slice(0, 120)}`);

  const bad = await req("POST", `/api/events/${eventId}/signup`, { name: "李四", phone: "abc" });
  ck("非法手机号被拒", bad.status === 400, `got ${bad.status}`);

  const after = await req("GET", `/api/events/${eventId}`);
  ck("taken 递增为 1", after.json?.taken === 1, JSON.stringify(after.json));
}

// ---------- 6. 名额上限（capacity=2） ----------
console.log("\n[6] 名额并发安全 / 满员");
{
  const r = await req("POST", `/api/events/${eventId}/signup`, { name: "李四", phone: "13900002222" });
  ck("第 2 人报名成功", r.status === 201, `got ${r.status}`);
  const full = await req("POST", `/api/events/${eventId}/signup`, { name: "王五", phone: "13700003333" });
  ck("满员后 410", full.status === 410, `got ${full.status} ${full.text.slice(0, 80)}`);
}

// ---------- 7. 管理端登录 ----------
console.log("\n[7] 管理端 PIN 登录");
let session = null;
{
  const nokey = await req("POST", `/api/admin/${eventId}/auth`, { key: "0".repeat(32), pin: PIN });
  ck("错误 key 403", nokey.status === 403, `got ${nokey.status}`);

  const nopin = await req("POST", `/api/admin/${eventId}/auth`, { key: globalThis.__key, pin: "000000" });
  ck("错误 PIN 401", nopin.status === 401, `got ${nopin.status}`);

  const ok = await req("POST", `/api/admin/${eventId}/auth`, { key: globalThis.__key, pin: PIN });
  ck("正确凭证登录成功", ok.status === 200 && /^[0-9a-f]{64}$/.test(ok.json?.token || ""),
    `got ${ok.status} ${ok.text.slice(0, 120)}`);
  ck("expiresIn = 86400", ok.json?.expiresIn === 86400);
  session = ok.json?.token;
}
if (!session) { console.log("\n登录失败，后续跳过"); process.exit(1); }
const AUTH = { authorization: `Bearer ${session}` };

// ---------- 8. 名单 ----------
console.log("\n[8] 名单与统计");
{
  const r = await req("GET", `/api/admin/${eventId}/signups`, null, AUTH);
  ck("返回 200", r.status === 200, `got ${r.status}`);
  ck("共 2 条报名", r.json?.signups?.length === 2, String(r.json?.signups?.length));
  ck("stats 正确", r.json?.stats?.total === 2 && r.json?.stats?.checked === 0 && r.json?.stats?.unchecked === 2,
    JSON.stringify(r.json?.stats));
  signupId = r.json?.signups?.find(s => s.phone === "13800001111")?.id ?? null;
  const noauth = await req("GET", `/api/admin/${eventId}/signups`);
  ck("无 session 401", noauth.status === 401, `got ${noauth.status}`);
}

// ---------- 9. 扫码签到（token / JSON 包裹） ----------
console.log("\n[9] 签到");
{
  const r = await req("POST", `/api/admin/${eventId}/checkin`, { token: JSON.stringify({ t: signupToken }) }, AUTH);
  ck("扫码签到成功（JSON 包裹）", r.status === 200 && r.json?.ok === true && r.json?.already_checked === false,
    `got ${r.status} ${r.text.slice(0, 120)}`);
  ck("返回签到时间", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.json?.checked_in_at || ""), r.json?.checked_in_at);

  const again = await req("POST", `/api/admin/${eventId}/checkin`, { token: signupToken }, AUTH);
  ck("重复签到幂等", again.status === 200 && again.json?.already_checked === true,
    `got ${again.status} ${again.text.slice(0, 120)}`);

  const manual = await req("POST", `/api/admin/${eventId}/checkin`, { phone: "13900002222" }, AUTH);
  ck("手机号补签成功", manual.status === 200 && manual.json?.already_checked === false, `got ${manual.status}`);

  const miss = await req("POST", `/api/admin/${eventId}/checkin`, { token: "f".repeat(32) }, AUTH);
  ck("未知签到码 404", miss.status === 404, `got ${miss.status}`);
}

// ---------- 10. 撤销签到 ----------
console.log("\n[10] 撤销签到");
{
  const r = await req("POST", `/api/admin/${eventId}/uncheck`, { signup_id: signupId }, AUTH);
  ck("撤销成功", r.status === 200 && r.json?.ok === true, `got ${r.status}`);
  const list = await req("GET", `/api/admin/${eventId}/signups`, null, AUTH);
  ck("统计同步更新", list.json?.stats?.checked === 1 && list.json?.stats?.unchecked === 1,
    JSON.stringify(list.json?.stats));
}

// ---------- 11. CSV 导出 ----------
console.log("\n[11] CSV 导出");
{
  const r = await req("GET", `/api/admin/${eventId}/export?token=${session}`);
  ck("返回 200 text/csv", r.status === 200 && (r.headers.get("content-type") || "").includes("text/csv"),
    `got ${r.status} ${r.headers.get("content-type")}`);
  ck("Content-Disposition 带文件名", (r.headers.get("content-disposition") || "").includes(".csv"),
    r.headers.get("content-disposition"));

  // 注意：fetch 的 text() 按 UTF-8 decode 规范会自动吃掉前导 BOM，必须验原始字节
  const buf = await fetch(`${BASE}/api/admin/${eventId}/export?token=${session}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).then(x => x.arrayBuffer()).then(b => new Uint8Array(b));
  ck("带 UTF-8 BOM（原始字节 EF BB BF）",
    buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf,
    `first3=${[...buf.slice(0, 3)].map(b => b.toString(16).padStart(2, "0")).join(" ")}`);

  ck("表头中文正常", r.text.includes("姓名,手机号,签到状态"),
    JSON.stringify(r.text.slice(0, 40)));
  ck("含 2 行数据", r.text.trim().split("\r\n").length === 3, String(r.text.trim().split("\r\n").length));
  ck("签到状态列正确", r.text.includes("未签到") && r.text.includes("已签到"));
}

// ---------- 12. 截止报名 ----------
console.log("\n[12] 截止 / 恢复报名");
{
  const r = await req("POST", `/api/admin/${eventId}/close`, { closed: true }, AUTH);
  ck("截止成功", r.status === 200 && r.json?.closed === true, `got ${r.status}`);
  const info = await req("GET", `/api/events/${eventId}`);
  ck("公开页显示 closed", info.json?.closed === true);
  const blocked = await req("POST", `/api/events/${eventId}/signup`, { name: "赵六", phone: "13600004444" });
  ck("截止后报名 410", blocked.status === 410, `got ${blocked.status} ${blocked.text.slice(0, 80)}`);
  const open = await req("POST", `/api/admin/${eventId}/close`, { closed: false }, AUTH);
  ck("恢复报名", open.status === 200 && open.json?.closed === false);
}

// ---------- A. 账号系统 ----------
console.log("\n[A] 账号系统（注册/登录/免 PIN 管理）");
{
  const email = `e2e-${stamp}@probe.test`;
  const password = "probe1234";

  const reg = await req("POST", "/api/account/register", { email, password, displayName: "探针" });
  ck("注册返回 201", reg.status === 201, `got ${reg.status} ${reg.text.slice(0, 120)}`);
  const sc = (reg.headers.get("set-cookie") || "").split(";")[0];
  ck("下发 es_acct Cookie", sc.startsWith("es_acct="), sc);
  const acctCookie = sc;

  const dupReg = await req("POST", "/api/account/register", { email, password });
  ck("重复邮箱 409", dupReg.status === 409, `got ${dupReg.status}`);

  const me0 = await req("GET", "/api/account/me", null, { cookie: acctCookie });
  ck("me 返回账号", me0.status === 200 && me0.json?.account?.email === email, JSON.stringify(me0.json));

  // 登录态下创建活动（PIN 留空 → owner 绑定，免 PIN）
  const c = await req("POST", "/api/events", { name: NAME + " (账号)", event_time: "2026-10-02 10:00", capacity: 5 }, { cookie: acctCookie });
  ck("账号创建活动 201", c.status === 201, `got ${c.status} ${c.text.slice(0, 120)}`);
  ck("owner 标记 true", c.json?.owner === true);
  ck("管理链接不带 key（免 PIN）", !c.json?.manage_path?.includes("key="), c.json?.manage_path);
  const acctEventId = c.json?.id;

  // 账号免 PIN 进管理页
  const list = await req("GET", `/api/admin/${acctEventId}/signups`, null, { cookie: acctCookie });
  ck("账号 owner 免 PIN 进管理", list.status === 200, `got ${list.status} ${list.text.slice(0, 120)}`);

  // 无登录访问他人活动被拒
  const noAuth = await req("GET", `/api/admin/${acctEventId}/signups`);
  ck("无登录访问被拒", noAuth.status === 401 || noAuth.status === 403, `got ${noAuth.status}`);

  const mine = await req("GET", "/api/account/events", null, { cookie: acctCookie });
  ck("我的活动列表含刚建活动", (mine.json?.events || []).some(e => e.id === acctEventId),
    JSON.stringify((mine.json?.events || []).map(e => e.id)));

  // 编辑 / 软删 / 回收站 / 恢复
  const edit = await req("PUT", `/api/events/${acctEventId}`, { name: NAME + " (改)" }, { cookie: acctCookie });
  ck("账号编辑活动 PUT", edit.status === 200 && edit.json?.event?.name === NAME + " (改)", `got ${edit.status} ${edit.text.slice(0, 120)}`);

  const del = await req("DELETE", `/api/events/${acctEventId}`, null, { cookie: acctCookie });
  ck("账号软删活动", del.status === 200, `got ${del.status}`);
  const trash = await req("GET", "/api/account/events?scope=trash", null, { cookie: acctCookie });
  ck("回收站可见已删活动", (trash.json?.events || []).some(e => e.id === acctEventId), JSON.stringify((trash.json?.events || []).map(e => e.id)));
  const restore = await req("POST", `/api/events/${acctEventId}/restore`, null, { cookie: acctCookie });
  ck("恢复活动", restore.status === 200 && restore.json?.restored === true, `got ${restore.status}`);
  const active = await req("GET", "/api/account/events", null, { cookie: acctCookie });
  ck("恢复后回到活跃列表", (active.json?.events || []).some(e => e.id === acctEventId), JSON.stringify((active.json?.events || []).map(e => e.id)));

  // 报名自定义字段：创建带 fields → 报名带 company/remark → 名单含字段
  const fe = await req("POST", "/api/events", {
    name: NAME + " (字段)", event_time: "2026-10-03 09:00", capacity: 5,
    fields: { company: true, remark: true },
  }, { cookie: acctCookie });
  ck("账号创建带 fields 活动", fe.status === 201 && fe.json?.owner === true, `got ${fe.status}`);
  const feId = fe.json?.id;
  const fget = await req("GET", `/api/events/${feId}`);
  ck("公开信息含 fields", fget.json?.fields?.company === true && fget.json?.fields?.remark === true, JSON.stringify(fget.json?.fields));
  const fsign = await req("POST", `/api/events/${feId}/signup`, { name: "王二", phone: "13500005555", company: "测试公司", remark: "带备注" });
  ck("带字段报名 201", fsign.status === 201, `got ${fsign.status}`);
  const flist = await req("GET", `/api/admin/${feId}/signups`, null, { cookie: acctCookie });
  const fs = (flist.json?.signups || []).find(s => s.phone === "13500005555");
  ck("名单含 company/remark", fs?.company === "测试公司" && fs?.remark === "带备注", JSON.stringify(fs));

  // 协作多人管理
  const email2 = `e2e2-${stamp}@probe.test`;
  const reg2 = await req("POST", "/api/account/register", { email: email2, password: "probe1234", displayName: "协作者" });
  ck("协作账号2注册", reg2.status === 201, `got ${reg2.status}`);
  const cookie2 = (reg2.headers.get("set-cookie") || "").split(";")[0];
  const inv = await req("POST", `/api/events/${acctEventId}/collaborators`, { email: email2 }, { cookie: acctCookie });
  ck("owner 邀请协作者", inv.status === 201 && inv.json?.collaborator?.email === email2, `got ${inv.status} ${inv.text.slice(0, 120)}`);
  const colist = await req("GET", `/api/events/${acctEventId}/collaborators`, null, { cookie: acctCookie });
  ck("协作者列表含账号2", (colist.json?.collaborators || []).some(c => c.email === email2), JSON.stringify(colist.json?.collaborators));
  const cadmin = await req("GET", `/api/admin/${acctEventId}/signups`, null, { cookie: cookie2 });
  ck("协作者可进管理页", cadmin.status === 200, `got ${cadmin.status}`);
  const cinv = await req("POST", `/api/events/${acctEventId}/collaborators`, { email: email2 }, { cookie: cookie2 });
  ck("协作者不能邀请他人(403)", cinv.status === 403, `got ${cinv.status}`);
  const cId = (colist.json?.collaborators || []).find(c => c.email === email2)?.account_id;
  const rmCol = await req("DELETE", `/api/events/${acctEventId}/collaborators/${encodeURIComponent(cId || "")}`, null, { cookie: acctCookie });
  ck("owner 移除协作者", rmCol.status === 200, `got ${rmCol.status}`);
  if (process.env.TOKEN_FILE || process.env.CLOUDFLARE_API_TOKEN) {
    try {
      const { readFileSync } = await import("node:fs");
      const token = (process.env.TOKEN_FILE ? readFileSync(process.env.TOKEN_FILE, "utf8").trim() : "") || process.env.CLOUDFLARE_API_TOKEN;
      const dbs = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
      const db = dbs.result.find(d => d.name === "event-signin-db");
      const q = sql => fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${db.uuid}/query`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sql }) }).then(r => r.json());
      const a2 = await q(`SELECT id FROM accounts WHERE email='${email2}'`);
      const a2id = a2.result?.[0]?.results?.[0]?.id;
      if (a2id) { await q(`DELETE FROM account_sessions WHERE account_id='${a2id}'`); await q(`DELETE FROM accounts WHERE id='${a2id}'`); }
      ck("协作账号2已清理", true);
    } catch (e) { console.log(`  账号2清理失败: ${e.message}`); }
  } else { console.log(`  协作账号2 ${email2} 未清理（无令牌）`); }

  // 登出 → me 401
  const out = await req("POST", "/api/account/logout", null, { cookie: acctCookie });
  ck("登出 200", out.status === 200);
  const me1 = await req("GET", "/api/account/me", null, { cookie: acctCookie });
  ck("登出后 me 401", me1.status === 401, `got ${me1.status}`);

  // 重新登录 + 错误密码
  const login = await req("POST", "/api/account/login", { email, password });
  ck("重新登录 200", login.status === 200 && (login.headers.get("set-cookie") || "").includes("es_acct="), `got ${login.status}`);
  const badLogin = await req("POST", "/api/account/login", { email, password: "wrong" });
  ck("错误密码 401", badLogin.status === 401, `got ${badLogin.status}`);

  // 清理账号数据（需 D1 令牌）
  if (process.env.TOKEN_FILE || process.env.CLOUDFLARE_API_TOKEN) {
    try {
      const { readFileSync } = await import("node:fs");
      const token = (process.env.TOKEN_FILE ? readFileSync(process.env.TOKEN_FILE, "utf8").trim() : "") || process.env.CLOUDFLARE_API_TOKEN;
      const dbs = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
      const db = dbs.result.find(d => d.name === "event-signin-db");
      const q = sql => fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${db.uuid}/query`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sql }),
      }).then(r => r.json());
      const acc = await q(`SELECT id FROM accounts WHERE email='${email}'`);
      const accId = acc.result?.[0]?.results?.[0]?.id;
      if (accId) {
        await q(`DELETE FROM account_sessions WHERE account_id='${accId}'`);
        await q(`DELETE FROM events WHERE owner_id='${accId}'`);
        await q(`DELETE FROM accounts WHERE id='${accId}'`);
      }
      ck("账号测试数据已清理", true);
    } catch (e) { console.log(`  账号清理失败: ${e.message}`); }
  } else {
    console.log(`  账号测试账号 ${email} 未清理（无令牌）`);
  }
}

// ---------- 13. 前端静态页 ----------
console.log("\n[13] 静态页面");
for (const p of ["/index.html", "/e.html", "/manage.html", "/css/style.css", "/js/api.js", "/js/poster.js", "/vendor/qrcode.min.js", "/vendor/jsQR.js", "/og-default.png"]) {
  let r = null;
  for (let i = 0; i < 3 && !r; i++) {
    try { r = await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch { if (i === 2) throw new Error(`GET ${p} 连接失败`); await new Promise(s => setTimeout(s, 1000 * (i + 1))); }
  }
  ck(`${p} 可访问`, r.status === 200, `got ${r.status}`);
}

// ---------- 13b. 动态 OG meta（分享预览） ----------
console.log("\n[13b] 动态 OG meta");
{
  let r = null;
  for (let i = 0; i < 3 && !r; i++) {
    try { r = await fetch(`${BASE}/e.html?id=${eventId}`, { signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch { if (i === 2) throw new Error("GET /e.html 连接失败"); await new Promise(s => setTimeout(s, 1000 * (i + 1))); }
  }
  const html = await r.text();
  ck("e.html 200", r.status === 200, `got ${r.status}`);
  ck("注入 og:title 为活动名", html.includes('property="og:title"') && html.includes(NAME), "");
  ck("og:image 指向 og-default.png", html.includes(`property="og:image" content="${BASE}/og-default.png"`), "");
  ck("og:description 含活动时间", /og:description" content="[^"]*2026-10-01 14:30/.test(html), "");
  ck("canonical 指向报名页", html.includes(`rel="canonical" href="${BASE}/e.html?id=${eventId}"`), "");
  ck("占位标记已替换", !html.includes("<!--og-meta-->"), "");
  ck("主 og:image 唯一", (html.match(/property="og:image"/g) || []).length === 1, "");
  const png = await fetch(`${BASE}/og-default.png`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  ck("og-default.png 为 PNG", png.status === 200 && (png.headers.get("content-type") || "").includes("image/png"), `got ${png.status} ${png.headers.get("content-type")}`);
}

// ---------- 14. 清理测试数据 ----------
if (process.env.TOKEN_FILE || process.env.CLOUDFLARE_API_TOKEN) {
  console.log("\n[14] 清理测试数据");
  try {
    const { readFileSync } = await import("node:fs");
    const token = (process.env.TOKEN_FILE ? readFileSync(process.env.TOKEN_FILE, "utf8").trim() : "")
      || process.env.CLOUDFLARE_API_TOKEN;
    const dbs = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());
    const db = dbs.result.find(d => d.name === "event-signin-db");
    const q = sql => fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${db.uuid}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    }).then(r => r.json());
    await q(`DELETE FROM signups WHERE event_id = '${eventId}'`);
    await q(`DELETE FROM admin_sessions WHERE event_id = '${eventId}'`);
    await q(`DELETE FROM events WHERE id = '${eventId}'`);
    const v = await q(`SELECT COUNT(*) AS n FROM events WHERE id = '${eventId}'`);
    ck("测试活动已清除", v.result?.[0]?.results?.[0]?.n === 0, JSON.stringify(v.result?.[0]?.results));
  } catch (e) {
    console.log(`  清理失败（不影响功能）: ${e.message}`);
  }
} else {
  console.log(`\n[14] 跳过清理（无令牌）。残留活动 id=${eventId}`);
}

console.log(`\n===== pass=${pass} fail=${fail} =====`);
if (fails.length) console.log("失败用例:\n - " + fails.join("\n - "));
process.exit(fail ? 1 : 0);
