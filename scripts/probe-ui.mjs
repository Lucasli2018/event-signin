// 管理页交互探针：真实无头 Chrome + CDP，验证 manage.js 的交互行为
// （dump-dom 全绿 ≠ 能交互：脚本语法错误、库缺失、事件不触发都只有真跑才暴露）
//
// 用法：
//   BASE=http://localhost:8789 node scripts/probe-ui.mjs
//
// 覆盖：脚本无报错 / 名单渲染 / 公司备注展示 / 筛选生效 / 搜索生效 /
//       行点击弹签到码且二维码真实渲染 / 撤销按钮不冒泡误触 / 详情卡片回填
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.env.BASE || "http://localhost:8789").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH
  || "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const PORT = Number(process.env.CDP_PORT || 9333);

let pass = 0, fail = 0;
const fails = [];
function ck(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name} ${extra}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = "GET", body, cookie } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, json, text, headers: r.headers };
}

// ---------- 0. 造数据 ----------
console.log("\n[0] 准备数据");
const stamp = Date.now().toString(36);
const email = `ui-${stamp}@probe.test`;
const reg = await api("/api/account/register", {
  method: "POST", body: { email, password: "probe1234", displayName: "UI探针" },
});
const cookie = (reg.headers.get("set-cookie") || "").split(";")[0];
ck("注册探针账号", reg.status === 201 && cookie.startsWith("es_acct="), `got ${reg.status}`);

const ev = await api("/api/events", {
  method: "POST",
  cookie,
  body: {
    name: `UI探针活动${stamp}`,
    event_time: "2026-12-01 10:00",
    location: "测试场地A",
    description: "UI 探针简介",
    capacity: 10,
    fields: { company: true, remark: true },
  },
});
ck("创建带字段活动", ev.status === 201, `got ${ev.status}`);
const evId = ev.json?.id;

const s1 = await api(`/api/events/${evId}/signup`, {
  method: "POST", body: { name: "张三", phone: "13800001111", company: "甲公司", remark: "素食" },
});
const s2 = await api(`/api/events/${evId}/signup`, {
  method: "POST", body: { name: "李四", phone: "13800002222", company: "乙公司", remark: "" },
});
ck("报名 2 人", s1.status === 201 && s2.status === 201, `got ${s1.status}/${s2.status}`);
const chk = await api(`/api/admin/${evId}/checkin`, {
  method: "POST", cookie, body: { token: s1.json?.token },
});
ck("张三已签到", chk.status === 200 && chk.json?.already_checked !== true, `got ${chk.status}`);

// ---------- 1. 起 Chrome ----------
console.log("\n[1] 启动无头 Chrome");
const userDataDir = mkdtempSync(join(tmpdir(), "es-ui-probe-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu",
  "--disable-extensions", "--disable-background-networking",
  "about:blank",
], { stdio: "ignore" });

let wsUrl = null;
for (let i = 0; i < 30 && !wsUrl; i++) {
  await sleep(500);
  try {
    const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
    wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl || null;
  } catch { /* 还没起来 */ }
}
if (!wsUrl) {
  console.log("  Chrome 启动失败，探针中止");
  chrome.kill();
  process.exit(1);
}
console.log("  ok   Chrome 已就绪");

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`${method} 超时`)); }
    }, 20000);
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", {
    expression: `(() => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "evaluate 异常");
  return r.result?.value;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");

// 页面加载前注入错误收集（脚本解析/运行错误都要能抓到）
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `window.__errs = [];
    window.addEventListener("error", (e) => window.__errs.push("error: " + (e.message || e.type)));
    window.addEventListener("unhandledrejection", (e) => window.__errs.push("rejection: " + e.reason));`,
});

// 注入账号 Cookie（域名用 127.0.0.1，与导航地址一致）
const [cName, cVal] = cookie.split("=");
const host = new URL(BASE).hostname;
await send("Network.setCookie", { name: cName, value: cVal, domain: host, path: "/" });

// ---------- 2. 打开管理页 ----------
console.log("\n[2] 管理页加载");
const manageUrl = `${BASE}/manage.html?id=${encodeURIComponent(evId)}`;
await send("Page.navigate", { url: manageUrl });

// 等名单渲染出来（真实时钟轮询，不用虚拟时间）
let rows = 0;
for (let i = 0; i < 40 && rows !== 2; i++) {
  await sleep(500);
  try { rows = await evaluate("return document.querySelectorAll('#list li').length"); } catch { rows = 0; }
}
ck("名单渲染 2 行（脚本可执行、接口通）", rows === 2, `got ${rows}`);

const errs = await evaluate("return window.__errs");
ck("页面无 JS 报错", Array.isArray(errs) && errs.length === 0, JSON.stringify(errs));

const hasQRCodeLib = await evaluate("return typeof QRCode !== 'undefined'");
ck("QRCode 库已加载（未引 qrcode.min.js 会 ReferenceError）", hasQRCodeLib === true);

// ---------- 3. 详情卡片 / 字段展示 ----------
console.log("\n[3] 详情卡片与字段");
const infoText = await evaluate("return (document.getElementById('evInfo') || {}).textContent || ''");
ck("详情卡片含报名状态", infoText.includes("报名中"), infoText.slice(0, 60));
ck("详情卡片含剩余名额", infoText.includes("剩余名额"), infoText.slice(0, 60));
ck("详情卡片不再出现「软删除」噪音", !infoText.includes("软删除"), infoText.slice(0, 80));

const extras = await evaluate("return [...document.querySelectorAll('#list li .extra')].map(e => e.textContent)");
ck("名单展示公司/备注（extraText 已接入）",
  Array.isArray(extras) && extras.some((t) => t.includes("甲公司") && t.includes("素食")),
  JSON.stringify(extras));

const countText = await evaluate("return (document.getElementById('listCount') || {}).textContent || ''");
ck("显示名单人数", countText.includes("2 人"), countText);

// ---------- 4. 筛选 ----------
console.log("\n[4] 筛选与搜索");
await evaluate("document.getElementById('filterUnchecked').click(); return 1");
await sleep(200);
const uncheckedRows = await evaluate("return document.querySelectorAll('#list li').length");
ck("「未签到」筛选生效（2 人 → 1 人）", uncheckedRows === 1, `got ${uncheckedRows}`);

const activeCls = await evaluate("return document.getElementById('filterUnchecked').classList.contains('active')");
ck("筛选按钮高亮选中态", activeCls === true);

await evaluate("document.getElementById('filterChecked').click(); return 1");
await sleep(200);
const checkedName = await evaluate("return (document.querySelector('#list li .name') || {}).textContent || ''");
ck("「已签到」筛选只剩张三", checkedName === "张三", checkedName);

await evaluate("document.getElementById('filterAll').click(); return 1");
await sleep(200);
const allRows = await evaluate("return document.querySelectorAll('#list li').length");
ck("「全部」恢复 2 行", allRows === 2, `got ${allRows}`);

await evaluate(`const i = document.getElementById('searchInput');
  i.value = '乙公司'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1`);
await sleep(200);
const searchRows = await evaluate("return document.querySelectorAll('#list li').length");
const searchName = await evaluate("return (document.querySelector('#list li .name') || {}).textContent || ''");
ck("搜索公司名命中 1 行", searchRows === 1 && searchName === "李四", `${searchRows} / ${searchName}`);

await evaluate(`const i = document.getElementById('searchInput');
  i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return 1`);
await sleep(200);

// ---------- 5. 点击行查看签到码 ----------
console.log("\n[5] 签到码弹窗");
await evaluate("document.querySelectorAll('#list li')[0].click(); return 1");
await sleep(400);
const qrOpen = await evaluate("return !document.getElementById('qrModal').classList.contains('hidden')");
ck("点击名单行弹出签到码弹窗", qrOpen === true);

const qrName = await evaluate("return document.getElementById('qrName').textContent");
ck("弹窗标题含姓名与手机号", qrName.includes("张三") && qrName.includes("13800001111"), qrName);

// 二维码必须真的渲染出节点（canvas 或 img），否则是空弹窗
const qrRendered = await evaluate(
  "return document.querySelectorAll('#qrSlot canvas, #qrSlot img').length");
ck("二维码已真实渲染（canvas/img 存在）", qrRendered > 0, `got ${qrRendered}`);

const qrToken = await evaluate("return document.getElementById('qrToken').textContent");
ck("弹窗展示签到码原文", /签到码：\s*[0-9a-f]{32}/.test(qrToken), qrToken);

await evaluate("document.getElementById('qrClose').click(); return 1");
await sleep(200);
const qrClosed = await evaluate("return document.getElementById('qrModal').classList.contains('hidden')");
ck("关闭按钮可关闭弹窗", qrClosed === true);

// ---------- 6. 撤销按钮不得冒泡误触签到码 ----------
console.log("\n[6] 撤销按钮事件隔离");
await evaluate("document.querySelectorAll('#list li')[0].querySelector('.uncheck-btn').click(); return 1");
await sleep(300);
const afterUndo = await evaluate(`return {
  qr: !document.getElementById('qrModal').classList.contains('hidden'),
  confirm: !document.getElementById('confirmModal').classList.contains('hidden'),
  title: document.getElementById('confirmTitle').textContent,
}`);
ck("点撤销不误弹签到码（stopPropagation 生效）", afterUndo.qr === false, JSON.stringify(afterUndo));
ck("撤销走统一确认弹窗", afterUndo.confirm === true && afterUndo.title.includes("撤销"), JSON.stringify(afterUndo));

await evaluate("document.getElementById('confirmNo').click(); return 1");
await sleep(200);
const undoStillChecked = await evaluate("return document.querySelectorAll('#list li .uncheck-btn').length");
ck("取消确认后未撤销（仍为已签到）", undoStillChecked === 1, `got ${undoStillChecked}`);

// ---------- 7. 报名页字段联动（后端 GET fields 修好后应渲染输入框） ----------
console.log("\n[7] 报名页字段联动");
await send("Page.navigate", { url: `${BASE}/e.html?id=${encodeURIComponent(evId)}` });
let extraInputs = 0;
for (let i = 0; i < 30 && extraInputs !== 2; i++) {
  await sleep(400);
  try {
    extraInputs = await evaluate("return document.querySelectorAll('#extraFields input').length");
  } catch { extraInputs = 0; }
}
ck("报名页渲染公司/备注输入框（GET fields 已生效）", extraInputs === 2, `got ${extraInputs}`);

// ---------- 收尾 ----------
try { ws.close(); } catch { /* ignore */ }
chrome.kill();
await sleep(500);
try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }

// 清理测试数据
try {
  await api(`/api/events/${evId}`, { method: "DELETE", cookie });
  console.log("\n[8] 测试活动已软删");
} catch { /* ignore */ }

console.log(`\n===== pass=${pass} fail=${fail} =====`);
if (fails.length) console.log("失败用例:\n - " + fails.join("\n - "));
process.exit(fail ? 1 : 0);
