// D1 远程初始化脚本
// 用法：
//   设置 CLOUDFLARE_API_TOKEN 环境变量（需 D1 编辑权限），或用 TOKEN_FILE 指定令牌文件
//   node scripts/init-d1.mjs            # 仅应用 schema（DB 必须已存在）
//   node scripts/init-d1.mjs --create   # 不存在则自动创建 D1 数据库
//
// 幂等：schema.sql 全部为 CREATE ... IF NOT EXISTS，可重复执行。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ACCT = process.env.CLOUDFLARE_ACCOUNT_ID || "332b848d9f5d9ec2808bdb855763eb8e";
const DB_NAME = "event-signin-db";
const CREATE = process.argv.includes("--create");

const token = (process.env.TOKEN_FILE ? readFileSync(process.env.TOKEN_FILE, "utf8").trim() : "")
  || process.env.CLOUDFLARE_API_TOKEN || "";
if (!token) { console.error("缺少 CLOUDFLARE_API_TOKEN 或 TOKEN_FILE"); process.exit(1); }

// 本机到 CF 的链路会间歇性抖动，全部纳入重试
const api = async (path, opts = {}, retries = 8) => {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}${path}`, {
        ...opts,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
      });
      const j = await r.json();
      if (j.success) return j.result;
      lastErr = new Error(JSON.stringify(j.errors));
      throw lastErr;
    } catch (e) {
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, 800 * (i + 1)));
    process.stderr.write(`  retry ${i + 1}/${retries}\n`);
  }
  throw lastErr;
};

// 1. 找 / 建 D1 数据库
const dbs = await api("/d1/database");
let db = dbs.find(d => d.name === DB_NAME);
if (!db) {
  if (!CREATE) { console.error(`未找到 ${DB_NAME}，请先创建或加 --create`); process.exit(1); }
  db = await api("/d1/database", { method: "POST", body: JSON.stringify({ name: DB_NAME }) });
  console.log(`已创建 D1 数据库 ${DB_NAME} (${db.uuid})`);
} else {
  console.log(`D1 数据库 ${DB_NAME} (${db.uuid})`);
}

const query = sql =>
  api(`/d1/database/${db.uuid}/query`, { method: "POST", body: JSON.stringify({ sql }) });

// 2. 读 schema.sql → 去注释 → 按分号拆语句 → 逐条执行
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const raw = readFileSync(join(root, "schema.sql"), "utf8");
const cleaned = raw.split("\n").filter(l => !l.trimStart().startsWith("--")).join("\n");
const stmts = cleaned.split(";").map(s => s.trim()).filter(Boolean);
console.log(`statements: ${stmts.length}`);

let ok = 0, fail = 0;
for (const s of stmts) {
  try { await query(s); ok++; }
  catch (e) {
    if (/duplicate column|already exists/i.test(e.message)) {
      console.log("SKIP (已存在):", s.slice(0, 70).replace(/\n/g, " "));
    } else {
      fail++;
      console.error(`FAIL: ${e.message}\n  SQL: ${s.slice(0, 90).replace(/\n/g, " ")}`);
    }
  }
}
console.log(`done: ok=${ok} fail=${fail}`);
if (fail) process.exit(1);

// 3. 自检：表名、索引、行数
const T = await query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
const I = await query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name");
const C = await query("SELECT (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM signups) AS signups, (SELECT COUNT(*) FROM admin_sessions) AS sessions");
console.log("tables :", T[0].results.map(r => r.name).join(", "));
console.log("indexes:", I[0].results.map(r => r.name).join(", "));
console.log("counts :", JSON.stringify(C[0].results[0]));
console.log("初始化完成 ✅");
