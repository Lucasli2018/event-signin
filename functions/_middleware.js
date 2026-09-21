// 全局中间件：CORS、错误兜底、本地/首访自动建表

let dbReady = false;
let initializing = false;

async function ensureDatabase(env) {
  if (dbReady || initializing) return;
  try {
    const result = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='events'"
    ).first();
    if (result) {
      dbReady = true;
      return;
    }

    initializing = true;
    console.log("[middleware] 首次访问，初始化数据库 schema…");

    const statements = [
      `CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT,
        pw_hash TEXT NOT NULL,
        pw_salt TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
      )`,
      `CREATE TABLE IF NOT EXISTS account_sessions (
        token TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        expires_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_account_sessions_acct ON account_sessions(account_id, expires_at)`,
      `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        event_time TEXT NOT NULL,
        location TEXT,
        description TEXT,
        capacity INTEGER NOT NULL CHECK (capacity > 0),
        taken INTEGER NOT NULL DEFAULT 0,
        admin_key TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        pin_salt TEXT NOT NULL,
        closed INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        owner_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        fields TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
      )`,
      `CREATE TABLE IF NOT EXISTS signups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        checked_in_at TEXT,
        company TEXT,
        remark TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        UNIQUE(event_id, phone)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_signups_event ON signups(event_id, checked_in_at)`,
      `CREATE TABLE IF NOT EXISTS admin_sessions (
        token TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
        expires_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_admin_sessions_event ON admin_sessions(event_id, expires_at)`,
    ];

    for (const sql of statements) {
      await env.DB.prepare(sql).run();
    }

    // 迁移：已存在的旧 events 表可能缺 owner_id 列，补上（幂等）
    try {
      const cols = await env.DB.prepare("PRAGMA table_info(events)").all();
      const has = (cols.results || []).some(c => c.name === "owner_id");
      if (!has) {
        await env.DB.prepare("ALTER TABLE events ADD COLUMN owner_id TEXT").run();
        console.log("[middleware] 已为 events 表补加 owner_id 列");
      }
      // 迁移：补 archived / deleted_at（幂等）
      const hasArch = (cols.results || []).some(c => c.name === "archived");
      const hasDel = (cols.results || []).some(c => c.name === "deleted_at");
      if (!hasArch) {
        await env.DB.prepare("ALTER TABLE events ADD COLUMN archived INTEGER NOT NULL DEFAULT 0").run();
        console.log("[middleware] 已为 events 表补加 archived 列");
      }
      if (!hasDel) {
        await env.DB.prepare("ALTER TABLE events ADD COLUMN deleted_at TEXT").run();
        console.log("[middleware] 已为 events 表补加 deleted_at 列");
      }
      // 迁移：协作者表（幂等建表，旧库首次访问时创建）
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS event_collaborators (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'editor',
          created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
          UNIQUE(event_id, account_id)
        )`
      ).run();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ec_event ON event_collaborators(event_id)").run();
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ec_acct ON event_collaborators(account_id)").run();
    } catch (e) {
      console.error("[middleware] owner_id 迁移失败:", e);
    }

    console.log("[middleware] 数据库初始化完成");
    dbReady = true;
  } catch (err) {
    console.error("[middleware] 数据库初始化失败:", err);
  } finally {
    initializing = false;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get("origin") || "*";

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  await ensureDatabase(env);

  const originalNext = context.next;
  context.next = async (nextContext) => {
    try {
      const response = await originalNext(nextContext);
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return response;
    } catch (err) {
      console.error("[middleware] 未捕获异常:", err);
      return new Response(JSON.stringify({ error: "服务器内部错误" }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
  };

  return context.next();
}
