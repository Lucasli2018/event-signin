// 临时脚本：往线上 D1 写入示例活动（幂等：先删种子 id 再插入）
// 运行：Bash 调用 node，node 内部用 powershell 读取 Machine 级 CLOUDFLARE_API_TOKEN
// 注意：本账号 D1 /query 端点不支持参数化 bindings，所有值内联进 SQL（数据均为可信硬编码）。
import { webcrypto } from "node:crypto";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const OUT = "D:/gitee/event-signin/scripts/_seed_out.txt";
function out(text) {
  writeFileSync(OUT, text, "utf8");
}

const crypto = webcrypto;
const ACCT = "332b848d9f5d9ec2808bdb855763eb8e";
const DB = "11405d6f-4f4a-4927-893b-29cbc0549478";

// 优先环境变量，否则由 node 内部调用 powershell 读取 Windows Machine 级凭据
let TOKEN = process.env.CF_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "";
if (!TOKEN) {
  try {
    TOKEN = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN','Machine')"],
      { encoding: "utf8" }
    ).trim();
  } catch (e) {
    TOKEN = "";
  }
}
if (!TOKEN) {
  const msg = "缺少 CF_TOKEN / CLOUDFLARE_API_TOKEN（请确认本机 Machine 级环境变量）";
  console.error(msg);
  out(msg);
  process.exit(1);
}

// 与 functions/_shared/crypto.js 完全一致：HMAC-SHA256(pin, salt)
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(password));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function genToken(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// SQL 字符串字面量转义（本账号 /query 不支持参数绑定，需内联）
function sq(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

const PIN = "000000"; // 示例活动统一登录 PIN
const seeds = [
  {
    id: "71b2c3d4e5",
    name: "北京前端技术沙龙 · 第 12 期",
    event_time: "2026-10-01 14:00",
    location: "北京市海淀区中关村创业大街",
    description: "聚焦现代前端工程化与 AI 辅助开发，邀请多位一线工程师分享实战经验，含茶歇与自由交流环节。",
    capacity: 100,
    taken: 12,
  },
  {
    id: "82c3d4e5f6",
    name: "上海周末读书会：科幻专题",
    event_time: "2026-10-18 19:30",
    location: "上海市徐汇区衡山路书屋",
    description: "本期共读《三体》与近期热门科幻短篇，欢迎带上你最爱的段落来现场朗读交流。",
    capacity: 50,
    taken: 47,
  },
  {
    id: "93d4e5f6a7",
    name: "深圳梧桐山户外徒步",
    event_time: "2026-11-22 08:30",
    location: "深圳市罗湖区梧桐山登山口",
    description: "半日轻徒步，路线约 8 公里，适合新手。请自备饮水与运动鞋，集合后统一出发。",
    capacity: 200,
    taken: 0,
  },
  {
    id: "a4e5f6a7b8",
    name: "广州青年创业分享夜",
    event_time: "2026-09-28 20:00",
    location: "广州市天河区珠江新城",
    description: "三位连续创业者聊聊从 0 到 1 的坑与机会，现场可自由对接资源。",
    capacity: 80,
    taken: 80, // 满员 → 测试「仅看有名额」过滤
  },
  {
    id: "b5f6a7b8c9",
    name: "杭州金秋音乐节",
    event_time: "2026-08-16 18:00",
    location: "杭州市西湖区音乐公园",
    description: "户外草坪音乐节，多支独立乐队轮番登场，已圆满落幕，欢迎回顾精彩瞬间。",
    capacity: 30,
    taken: 30, // 已结束 + 满
  },
  {
    id: "c6a7b8c9d0",
    name: "成都美食探店之旅",
    event_time: "2026-09-10 12:00",
    location: "成都市锦江区太古里",
    description: "跟随本地吃货达人打卡 6 家地道小店，人均 80 元，已结束可查看往期回顾。",
    capacity: 40,
    taken: 18, // 已结束
  },
];

// 本账号 D1 /query 仅接受 { sql }，不支持 bindings
async function execSql(sql) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCT}/d1/database/${DB}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    }
  );
  const json = await res.json();
  if (!json.success) {
    throw new Error("D1 错误: " + JSON.stringify(json.errors || json));
  }
  return json.result;
}

async function run() {
  // 1. 幂等删除已有种子
  for (const s of seeds) {
    await execSql(`DELETE FROM es_events WHERE id = ${sq(s.id)}`);
  }
  // 2. 逐条插入示例活动（PIN 哈希与项目算法一致，管理页可用 PIN 000000 登录）
  for (const s of seeds) {
    const salt = genToken(16);
    const hash = await hashPassword(PIN, salt);
    const adminKey = genToken(16);
    await execSql(
      `INSERT INTO es_events (id,name,event_time,location,description,capacity,taken,admin_key,pin_hash,pin_salt,closed,archived,listed,owner_id,fields)
       VALUES (${sq(s.id)},${sq(s.name)},${sq(s.event_time)},${sq(s.location)},${sq(s.description)},${s.capacity},${s.taken},${sq(adminKey)},${sq(hash)},${sq(salt)},0,0,1,NULL,NULL)`
    );
  }
  // 3. 统计广场可见活动数
  const stat = await execSql(
    "SELECT count(*) AS c FROM es_events WHERE listed=1 AND archived=0 AND deleted_at IS NULL"
  );
  const count = stat && stat.results && stat.results[0] ? stat.results[0].c : "?";

  let text = "✅ 示例活动写入成功（已幂等刷新）\n\n";
  for (const s of seeds) {
    text += `· ${s.id} | ${s.name} | ${s.event_time} | ${s.location} | 名额 ${s.taken}/${s.capacity}\n`;
  }
  text += `\n📊 广场当前可见活动总数：${count}\n`;
  console.log(text);
  out(text);
}

run().catch((e) => {
  const msg = "执行异常: " + (e && e.stack ? e.stack : e);
  console.error(msg);
  out(msg);
  process.exit(1);
});
