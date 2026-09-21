// 分享预览：为报名页构建动态 OG meta（微信/群分享卡片）
// 逻辑独立成模块，便于单测；由 _middleware.js 调用注入。

import { getEvent } from "./helpers.js";

export const DEFAULT_TITLE = "活动报名签到";
export const DEFAULT_DESC = "社区活动 / 培训班 / 聚会：扫码报名，现场签到，一键导出名单。";

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// 构建 OG meta 标签块（含 og:* / twitter:* / canonical）
export async function buildOgMeta(env, url) {
  const id = url.searchParams.get("id") || "";
  let title = DEFAULT_TITLE;
  let desc = DEFAULT_DESC;

  if (id) {
    try {
      const ev = await getEvent(env, id);
      if (ev) {
        title = ev.name || DEFAULT_TITLE;
        const parts = [];
        if (ev.event_time) parts.push("🕐 " + ev.event_time);
        if (ev.location) parts.push("📍 " + ev.location);
        if (ev.capacity) parts.push("名额 " + (ev.taken || 0) + "/" + ev.capacity);
        if (parts.length) desc = parts.join(" · ");
      }
    } catch (e) {
      console.error("[og] 查询活动失败:", e);
    }
  }

  const canonical = url.origin + "/e.html" + (id ? "?id=" + encodeURIComponent(id) : "");
  const imageAbs = url.origin + "/og-default.png";

  const meta = [
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="活动报名签到">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:image" content="${esc(imageAbs)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:url" content="${esc(canonical)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${esc(imageAbs)}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
  ].join("\n  ");

  return { title, desc, meta };
}

// 用 <!--og-meta--> 占位替换；找不到占位则插到 </head> 前
export function injectOgMeta(html, meta) {
  if (html.includes("<!--og-meta-->")) return html.replace("<!--og-meta-->", meta);
  return html.replace("</head>", "  " + meta + "\n</head>");
}
