-- event-signin 数据库 schema（供参考/手动建库；运行时 middleware 会自动幂等建表）

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
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,         -- 签到码内容（16 字节 hex）
  checked_in_at TEXT,                 -- NULL = 未签到
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
