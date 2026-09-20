# event-signin 活动报名与签到 MVP

社区活动 / 培训班 / 聚会 / 会议场景：创建活动 → 群里发报名链接 → 现场扫码签到 → 导出名单。
替代微信群接龙 + 纸笔签到。

## 功能

- 创建活动（名称 / 时间 / 地点 / 简介 / 名额 / 管理 PIN）
- 报名表单（姓名 + 手机号，同活动同号去重，重复提交幂等返回原签到码）
- 名额限制（条件 UPDATE 占位，并发不超卖）
- 报名成功即得**个人签到二维码**（截图保存）
- 组织者管理页：PIN 登录、名单实时统计、**摄像头扫码签到**（jsQR）、手机号手动补签、撤销签到、截止/恢复报名
- 导出 CSV（UTF-8 BOM，Excel 中文不乱码）

## 技术栈

Cloudflare Pages（静态，纯 HTML + 原生 JS 零构建）+ Pages Functions（API）+ D1（SQLite）。
QR 生成用本地 `vendor/qrcode.min.js`，扫码用本地 `vendor/jsQR.js`，无外部 CDN 依赖。

## 鉴权模型

- 创建活动后得到两个链接：
  - **报名链接** `/e.html?id=...` —— 公开发群里
  - **管理链接** `/manage.html?id=...&key=...` —— 含 admin_key，自己保存
- 管理页需再输入创建时设置的 6-8 位 PIN 换 session token（24h 有效，D1 存储，内存 rate-limit 15 分钟 20 次）
- 签到二维码内容为 `{"t":"<16字节hex token>"}`，不暴露报名记录 id

## 目录结构

```
public/                 静态前端
  index.html            创建活动
  e.html                报名页（含个人签到二维码）
  manage.html           管理页（扫码/名单/导出）
  vendor/               qrcode.min.js / jsQR.js
functions/
  _middleware.js        CORS + 首访自动建表
  _shared/              crypto(PIN哈希/token) + helpers(JSON/session/时间)
  api/events.js         POST 创建活动
  api/events/[id].js    GET 活动公开信息
  api/events/[id]/signup.js  POST 报名（名额并发安全）
  api/admin/[id]/auth.js     POST PIN 登录
  api/admin/[id]/signups.js  GET 名单+统计
  api/admin/[id]/checkin.js  POST 签到（token/手机号，幂等）
  api/admin/[id]/uncheck.js  POST 撤销签到
  api/admin/[id]/close.js    POST 截止/恢复报名
  api/admin/[id]/export.js   GET 导出 CSV
schema.sql              参考 schema（middleware 会自动幂等建表）
```

## 本地开发

```bash
wrangler pages dev public --port 8788 --d1 DB=event-signin-db
```

打开 http://localhost:8788 。首次访问 API 时 middleware 自动建表，无需手动迁移。

## 部署

```bash
# 1. 创建 D1
wrangler d1 create event-signin-db
# 2. 把返回的 database_id 填进 wrangler.toml
# 3. 部署
wrangler pages deploy public --project-name=event-signin
# 4. 在 Pages 项目 Settings → Functions → D1 bindings 绑定 DB → event-signin-db
```

> 摄像头扫码要求 HTTPS（Cloudflare Pages 默认满足）或 localhost。
