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
- 活动管理增强：组织者（账号 owner 或旧 PIN 会话）可**编辑**活动（名称/时间/地点/简介/名额，名额不得低于已报名数）、**归档**（保留数据、隐藏于活跃列表）、**软删除**（从列表隐藏，数据可恢复）

## 技术栈

Cloudflare Pages（静态，纯 HTML + 原生 JS 零构建）+ Pages Functions（API）+ D1（SQLite）。
QR 生成用本地 `vendor/qrcode.min.js`，扫码用本地 `vendor/jsQR.js`，无外部 CDN 依赖。

## 鉴权模型

系统支持**两套并列的鉴权方式**，互不冲突：

### A. 账号系统（推荐，多活动集中管理）
- 访问 `/account.html` 用**邮箱 + 密码**注册 / 登录（httpOnly Cookie `es_acct` 保存，30 天有效，本地 http 不加 Secure 便于开发，生产 https 自动加 Secure）。
- 登录后进入仪表盘：可集中看到「我的活动」列表，并直接创建 / 管理，**无需记忆管理链接与 PIN**。
- 登录态下创建的活动自动绑定 `events.owner_id`；管理页（`manage.html?id=...`，不带 key）检测到本账号是 owner 时**免 PIN 直接进**。
- 账号相关接口：`POST /api/account/register`、`POST /api/account/login`、`POST /api/account/logout`、`GET /api/account/me`、`GET /api/account/events`。
- 活动编辑 / 删除接口 `PUT|DELETE /api/events/[id]` 同样受 `_guard.js` 保护（旧 PIN 会话或账号 owner 二选一）；软删除后报名 / 签到 / 公开信息查询会因 `getEvent` 过滤而返回 404，管理端用 `getEventRaw` 仍可查看与恢复。
- 注册 / 登录均带内存 rate-limit（15 分钟 20 次）；密码用与 PIN 相同的 `HMAC-SHA256(password, salt)` 存储。
- *当前未做邮箱验证（无邮件服务），作为后续增强项。*

### B. 旧模式：每活动独立密钥 + PIN（向后兼容）
- 创建活动后得到两个链接：
  - **报名链接** `/e.html?id=...` —— 公开发群里
  - **管理链接** `/manage.html?id=...&key=...` —— 含 admin_key，自己保存
- 管理页需再输入创建时设置的 6-8 位 PIN 换 session token（24h 有效，D1 存储，内存 rate-limit 15 分钟 20 次）
- 签到二维码内容为 `{"t":"<16字节hex token>"}`，不暴露报名记录 id
- 未登录账号时创建活动仍**必须设置 PIN**；登录账号后创建则 PIN 可选（留空自动生成隐藏 PIN 作兜底）。

## 目录结构

```
public/                 静态前端
  index.html            创建活动
  e.html                报名页（含个人签到二维码）
  manage.html           管理页（扫码/名单/导出）
  vendor/               qrcode.min.js / jsQR.js
functions/
  _middleware.js        CORS + 首访自动建表（含 accounts/account_sessions + events.owner_id 迁移）
  _shared/              crypto(PIN哈希/token) + helpers(JSON/session/时间) + account(Cookie会话/账号校验)
  api/account/register.js  POST 邮箱注册（自动登录，写 Cookie）
  api/account/login.js     POST 邮箱登录（写 Cookie）
  api/account/logout.js    POST 登出（清 Cookie）
  api/account/me.js        GET 当前账号
  api/account/events.js    GET 我的活动列表
  api/events.js         POST 创建活动（登录态绑定 owner_id，PIN 可选）
  api/events/[id].js    GET 活动公开信息 / PUT 编辑 / DELETE 软删除（owner 或 PIN 会话）
  api/events/[id]/signup.js  POST 报名（名额并发安全）
  api/admin/_guard.js        管理端守卫（活动存在 + 旧 session 或 账号 owner 二选一）
  api/admin/[id]/auth.js     POST PIN 登录（旧模式）
  api/admin/[id]/signups.js  GET 名单+统计
  api/admin/[id]/checkin.js  POST 签到（token/手机号，幂等）
  api/admin/[id]/uncheck.js  POST 撤销签到
  api/admin/[id]/close.js    POST 截止/恢复报名
  api/admin/[id]/export.js   GET 导出 CSV
scripts/
  init-d1.mjs           远端 D1 建库 + 建表（幂等，跑完自检）
  probe-e2e.mjs         端到端探针（线上/本地真实 HTTP 全链路）
schema.sql              参考 schema（middleware 会自动幂等建表）
```

## 本地开发

```bash
wrangler pages dev public --port 8788 --d1 DB=event-signin-db
```

打开 http://localhost:8788 。首次访问 API 时 middleware 自动建表，无需手动迁移。

## 初始化 D1（远端）

```bash
# --create 会在库不存在时自动创建；不加则只应用 schema.sql
CLOUDFLARE_API_TOKEN=<token> node scripts/init-d1.mjs --create
```

幂等可重复执行；跑完自检表名 / 索引 / 行数。

## 部署

```bash
# 1. D1 已建好（event-signin-db，id 见 wrangler.toml）
# 2. 远端建表
CLOUDFLARE_API_TOKEN=<token> node scripts/init-d1.mjs
# 3. 部署（wrangler.toml 里的 [[d1_databases]] 会随部署同步为 Pages 的 D1 绑定）
CLOUDFLARE_ACCOUNT_ID=332b848d9f5d9ec2808bdb855763eb8e \
  wrangler pages deploy public --project-name=event-signin
# 4. 线上端到端验证
TOKEN_FILE=.tmp-token node scripts/probe-e2e.mjs
```

> 摄像头扫码要求 HTTPS（Cloudflare Pages 默认满足）或 localhost。

## 当前线上

- 站点：https://event-signin.pages.dev
- D1：`event-signin-db` (11405d6f-4f4a-4927-893b-29cbc0549478)
- 探针覆盖：404 / 创建 / 参数校验 / 公开信息脱敏 / 报名幂等 / 满员 410 / 错误 key 403 / 错误 PIN 401 / 登录 / 名单统计 / 扫码签到幂等 / 手机号补签 / 撤销 / CSV(BOM) / 截止报名 / 静态页可达

## 本机网络注意

`*.pages.dev` 同时返回 AAAA 与 A 记录，本机无 IPv6 出口 → Node undici 优先 IPv6 会 `UND_ERR_CONNECT_TIMEOUT`。
探针已内置 `dns.setDefaultResultOrder("ipv4first")` + 重试；自写脚本时同样处理，或改用 `curl -4`。

