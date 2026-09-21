-- event-signin 数据库 schema（供参考/手动建库；运行时 middleware 会自动幂等建表）

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,                -- 16 位随机 hex
  email TEXT NOT NULL UNIQUE,         -- 小写归一化后的邮箱
  display_name TEXT,                  -- 昵称（可选）
  pw_hash TEXT NOT NULL,              -- HMAC-SHA256(password, pw_salt)
  pw_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE TABLE IF NOT EXISTS account_sessions (
  token TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_sessions_acct ON account_sessions(account_id, expires_at);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,                -- 10 位随机 hex
  name TEXT NOT NULL,
  event_time TEXT NOT NULL,           -- 'YYYY-MM-DD HH:MM' 本地时间
  location TEXT,
  description TEXT,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  taken INTEGER NOT NULL DEFAULT 0,   -- 已占名额（条件更新防超卖）
  admin_key TEXT NOT NULL,            -- 管理链接密钥（Secret URL）
  pin_hash TEXT NOT NULL,             -- HMAC-SHA256(pin, pin_salt)
  pin_salt TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0,  -- 1 = 停止报名
  archived INTEGER NOT NULL DEFAULT 0, -- 1 = 已归档（保留数据但隐藏在活跃列表）
  deleted_at TEXT,                    -- 软删除时间，NULL = 未删
  owner_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,  -- 账号系统：所属组织者（旧活动为 NULL）
  fields TEXT,                      -- 报名自定义字段定义（JSON: {"company":bool,"remark":bool}）
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,         -- 签到码内容（16 字节 hex）
  checked_in_at TEXT,                 -- NULL = 未签到
  company TEXT,                       -- 报名自定义字段：公司（可选）
  remark TEXT,                        -- 报名自定义字段：备注（可选）
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  UNIQUE(event_id, phone)             -- 同活动同手机号防重复报名
);

CREATE INDEX IF NOT EXISTS idx_signups_event ON signups(event_id, checked_in_at);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_event ON admin_sessions(event_id, expires_at);

-- 活动协作者（多人协同管理）
CREATE TABLE IF NOT EXISTS event_collaborators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor',  -- editor | admin（目前均具管理权限）
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
  UNIQUE(event_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_ec_event ON event_collaborators(event_id);
CREATE INDEX IF NOT EXISTS idx_ec_acct ON event_collaborators(account_id);
