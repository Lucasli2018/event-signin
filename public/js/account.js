// 账号中心：登录/注册 + 我的活动 + 创建活动
// 复用 api.js 的 api()/showMsg()/hideMsg()/getQuery()/copyText()
// 登录态由后端写入 httpOnly Cookie（es_acct），前端无感自动携带。

const authCard = document.getElementById("authCard");
const dash = document.getElementById("dash");
const authMsg = document.getElementById("authMsg");
const authTitle = document.getElementById("authTitle");
const toggleText = document.getElementById("toggleText");
const toggleMode = document.getElementById("toggleMode");
const nameField = document.getElementById("nameField");
const btnAuth = document.getElementById("btnAuth");
const btnLogout = document.getElementById("btnLogout");

const createMsg = document.getElementById("createMsg");
const btnCreate = document.getElementById("btnCreate");
const evList = document.getElementById("evList");
const evEmpty = document.getElementById("evEmpty");

let mode = "login";

function switchMode(m) {
  mode = m;
  if (m === "login") {
    authTitle.textContent = "登录";
    btnAuth.textContent = "登录";
    toggleText.textContent = "还没有账号？";
    toggleMode.textContent = "去注册";
    nameField.style.display = "none";
    document.getElementById("fPassword").setAttribute("autocomplete", "current-password");
  } else {
    authTitle.textContent = "注册";
    btnAuth.textContent = "注册";
    toggleText.textContent = "已有账号？";
    toggleMode.textContent = "去登录";
    nameField.style.display = "";
    document.getElementById("fPassword").setAttribute("autocomplete", "new-password");
  }
}
toggleMode.addEventListener("click", (e) => {
  e.preventDefault();
  switchMode(mode === "login" ? "register" : "login");
  hideMsg(authMsg);
});

btnAuth.addEventListener("click", doAuth);
document.getElementById("fPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doAuth();
});

async function doAuth() {
  hideMsg(authMsg);
  const email = document.getElementById("fEmail").value.trim().toLowerCase();
  const password = document.getElementById("fPassword").value;
  const displayName = document.getElementById("fName").value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showMsg(authMsg, "邮箱格式不正确");
  if (password.length < 8) return showMsg(authMsg, "密码至少 8 位");
  if (mode === "register" && displayName.length > 40) return showMsg(authMsg, "昵称过长");

  btnAuth.disabled = true;
  try {
    const body = mode === "register"
      ? { email, password, displayName }
      : { email, password };
    const r = await api(`/api/account/${mode}`, { method: "POST", body });
    enterDash(r.account);
  } catch (err) {
    showMsg(authMsg, err.message);
  } finally {
    btnAuth.disabled = false;
  }
}

async function enterDash(account) {
  authCard.classList.add("hidden");
  dash.classList.remove("hidden");
  document.getElementById("hiName").textContent =
    account.displayName ? `你好，${account.displayName}` : `你好，${account.email}`;
  loadEvents();
}

btnLogout.addEventListener("click", async () => {
  try { await api("/api/account/logout", { method: "POST" }); } catch { /* ignore */ }
  location.reload();
});

// 创建活动（Cookie 自动带登录态 → owner_id 绑定，PIN 可留空）
btnCreate.addEventListener("click", async () => {
  hideMsg(createMsg);
  const name = document.getElementById("cName").value.trim();
  const timeRaw = document.getElementById("cTime").value;
  const location_ = document.getElementById("cLoc").value.trim();
  const description = document.getElementById("cDesc").value.trim();
  const capacity = Number(document.getElementById("cCap").value);
  const pin = document.getElementById("cPin").value.trim();

  if (name.length < 2) return showMsg(createMsg, "请填写活动名称（至少 2 字）");
  if (!timeRaw) return showMsg(createMsg, "请选择活动时间");
  if (!Number.isInteger(capacity) || capacity < 1) return showMsg(createMsg, "名额需为正整数");
  if (pin && !/^\d{6,8}$/.test(pin)) return showMsg(createMsg, "PIN 需为 6-8 位数字");

  const eventTime = timeRaw.replace("T", " ");
  btnCreate.disabled = true;
  btnCreate.textContent = "创建中…";
  try {
    const r = await api("/api/events", {
      method: "POST",
      body: { name, event_time: eventTime, location: location_, description, capacity, pin },
    });
    showMsg(createMsg, `🎉 已创建「${name}」，可在下方「我的活动」进入管理`, "ok");
    document.getElementById("cName").value = "";
    document.getElementById("cTime").value = "";
    document.getElementById("cLoc").value = "";
    document.getElementById("cDesc").value = "";
    document.getElementById("cPin").value = "";
    loadEvents(true);
  } catch (err) {
    showMsg(createMsg, err.message);
  } finally {
    btnCreate.disabled = false;
    btnCreate.textContent = "创建活动";
  }
});

async function loadEvents() {
  try {
    const r = await api("/api/account/events");
    const list = r.events || [];
    evList.innerHTML = "";
    evEmpty.classList.toggle("hidden", list.length > 0);
    evEmpty.textContent = "还没有活动，先创建一个吧";
    for (const ev of list) {
      const li = document.createElement("li");
      const closed = ev.closed ? "已截止" : "报名中";
      li.innerHTML = `
        <div class="ev-main">
          <div class="ev-name"></div>
          <div class="ev-meta">${escapeHtml(ev.event_time)} · 已报 ${ev.taken}/${ev.capacity} · ${closed}</div>
        </div>
        <div class="ev-actions">
          <a class="btn small" href="/manage.html?id=${encodeURIComponent(ev.id)}">管理</a>
          <a class="btn small secondary" href="/e.html?id=${encodeURIComponent(ev.id)}" target="_blank">报名链接</a>
          <button class="btn small secondary" type="button">复制</button>
        </div>`;
      li.querySelector(".ev-name").textContent = ev.name;
      const copyBtn = li.querySelector(".ev-actions button");
      copyBtn.onclick = () => copyText(`${location.origin}/e.html?id=${ev.id}`, copyBtn);
      evList.appendChild(li);
    }
  } catch (err) {
    if (err.status === 401) { location.reload(); }
    else { evEmpty.classList.remove("hidden"); evEmpty.textContent = "加载失败：" + err.message; }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// 启动：探测登录态，已登录直接进仪表盘
(async () => {
  try {
    const me = await api("/api/account/me");
    if (me && me.account) { enterDash(me.account); return; }
  } catch { /* 未登录 */ }
  switchMode("login");
})();
