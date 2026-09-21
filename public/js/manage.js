// 管理页：PIN 登录 → 名单 / 扫码签到 / 导出 / 截止报名
const eventId = getQuery("id");
const adminKey = getQuery("key");
let sessionToken = sessionStorage.getItem(`es-session-${eventId}`) || null;
let currentEvent = null;

const loginMsg = document.getElementById("loginMsg");

if (!eventId || !adminKey) {
  document.getElementById("loginCard").classList.add("hidden");
  document.getElementById("badLink").classList.remove("hidden");
}

// ============ 登录 ============
document.getElementById("btnLogin").addEventListener("click", doLogin);
document.getElementById("fPin").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});

async function doLogin() {
  hideMsg(loginMsg);
  const pin = document.getElementById("fPin").value.trim();
  if (!pin) return showMsg(loginMsg, "请输入 PIN");

  const btn = document.getElementById("btnLogin");
  btn.disabled = true;
  try {
    const r = await api(`/api/admin/${encodeURIComponent(eventId)}/auth`, {
      method: "POST",
      body: { key: adminKey, pin },
    });
    sessionToken = r.token;
    sessionStorage.setItem(`es-session-${eventId}`, sessionToken);
    enterMain(r.event);
  } catch (err) {
    showMsg(loginMsg, err.message);
  } finally {
    btn.disabled = false;
  }
}

function enterMain(ev) {
  document.getElementById("loginCard").classList.add("hidden");
  document.getElementById("mainArea").classList.remove("hidden");
  currentEvent = ev;
  renderEvent(ev);
  refreshList();
}

function renderEvent(ev) {
  document.title = `${ev.name} - 管理`;
  document.getElementById("evName").textContent = ev.name;
  document.getElementById("evTime").textContent = ev.event_time;
  if (ev.location) {
    document.getElementById("evLocRow").style.display = "";
    document.getElementById("evLoc").textContent = ev.location;
  }
  const pct = ev.capacity ? Math.min(100, (ev.taken / ev.capacity) * 100) : 0;
  document.getElementById("fill").style.width = pct + "%";
  document.getElementById("takenText").textContent = `已报 ${ev.taken}/${ev.capacity}`;
  document.getElementById("closedText").textContent = ev.closed ? "已截止报名" : "报名中";
  document.getElementById("btnClose").textContent = ev.closed ? "恢复报名" : "截止报名";
  document.getElementById("btnArchive").textContent = ev.archived ? "📂 取消归档" : "📦 归档";
}

// ============ 名单 ============
let closedState = false;

async function refreshList() {
  try {
    const r = await api(`/api/admin/${encodeURIComponent(eventId)}/signups`, { token: sessionToken });
    renderEvent(r.event);
    closedState = r.event.closed;

    document.getElementById("stTotal").textContent = r.stats.total;
    document.getElementById("stChecked").textContent = r.stats.checked;
    document.getElementById("stUnchecked").textContent = r.stats.unchecked;
    renderDashboard(r.stats);

    const ul = document.getElementById("list");
    ul.innerHTML = "";
    document.getElementById("emptyTip").classList.toggle("hidden", r.signups.length > 0);

    for (const s of r.signups) {
      const li = document.createElement("li");
      const checked = !!s.checked_in_at;
      li.innerHTML = `
        <span class="badge ${checked ? "checked" : "unchecked"}">${checked ? "已签到" : "未签到"}</span>
        <span class="name"></span>
        <span class="phone"></span>
        <span class="time">${checked ? escapeHtml(s.checked_in_at.slice(5, 16)) : escapeHtml((s.created_at || "").slice(5, 16))}</span>
      `;
      li.querySelector(".name").textContent = s.name;
      li.querySelector(".phone").textContent = s.phone;
      if (checked) {
        const undo = document.createElement("button");
        undo.className = "uncheck-btn";
        undo.textContent = "撤销";
        undo.onclick = () => uncheck(s.id);
        li.appendChild(undo);
      }
      ul.appendChild(li);
    }
  } catch (err) {
    if (err.status === 401) {
      sessionStorage.removeItem(`es-session-${eventId}`);
      location.reload();
    } else {
      alert(err.message);
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function extraText(s) {
  const parts = [];
  if (s.company) parts.push("公司：" + escapeHtml(s.company));
  if (s.remark) parts.push("备注：" + escapeHtml(s.remark));
  return parts.join(" · ");
}

// 签到看板：签到率进度条 + 按时段分布条形图
function renderDashboard(stats) {
  const total = stats.total || 0;
  const checked = stats.checked || 0;
  const rate = total ? Math.round((checked / total) * 100) : 0;
  const fill = document.getElementById("checkinFill");
  const txt = document.getElementById("checkinRateText");
  if (fill) fill.style.width = rate + "%";
  if (txt) txt.textContent = `签到率 ${rate}%（${checked}/${total}）`;

  const dist = stats.checkin_distribution || [];
  const bars = document.getElementById("distBars");
  if (!bars) return;
  bars.innerHTML = "";
  if (!dist.length) {
    bars.innerHTML = '<div class="empty" style="padding:10px 0">暂无签到记录</div>';
    return;
  }
  const max = Math.max(...dist.map((d) => d.count));
  for (const d of dist) {
    const row = document.createElement("div");
    row.className = "dist-row";
    const pct = max ? (d.count / max) * 100 : 0;
    row.innerHTML = `
      <span class="dist-bucket">${escapeHtml(d.bucket.slice(5))}</span>
      <span class="dist-bar"><span class="dist-fill" style="width:${pct}%"></span></span>
      <span class="dist-count">${d.count}</span>
    `;
    bars.appendChild(row);
  }
}

async function uncheck(signupId) {
  if (!confirm("确定撤销该签到？")) return;
  try {
    await api(`/api/admin/${encodeURIComponent(eventId)}/uncheck`, {
      method: "POST",
      token: sessionToken,
      body: { signup_id: signupId },
    });
    refreshList();
  } catch (err) {
    alert(err.message);
  }
}

document.getElementById("btnRefresh").addEventListener("click", refreshList);

document.getElementById("btnExport").addEventListener("click", () => {
  // 账号模式（sessionToken 为空）靠 Cookie 鉴权，导出走顶级导航自动带 Cookie
  const url = sessionToken
    ? `/api/admin/${encodeURIComponent(eventId)}/export?token=${encodeURIComponent(sessionToken)}`
    : `/api/admin/${encodeURIComponent(eventId)}/export`;
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
});

document.getElementById("btnClose").addEventListener("click", async () => {
  try {
    const r = await api(`/api/admin/${encodeURIComponent(eventId)}/close`, {
      method: "POST",
      token: sessionToken,
      body: { closed: !closedState },
    });
    closedState = r.closed;
    refreshList();
  } catch (err) {
    alert(err.message);
  }
});

// ============ Tab 切换 ============
const tabScan = document.getElementById("tabScan");
const tabList = document.getElementById("tabList");
tabScan.addEventListener("click", () => switchTab("scan"));
tabList.addEventListener("click", () => switchTab("list"));

function switchTab(tab) {
  const isScan = tab === "scan";
  tabScan.classList.toggle("active", isScan);
  tabList.classList.toggle("active", !isScan);
  document.getElementById("panelScan").classList.toggle("hidden", !isScan);
  document.getElementById("panelList").classList.toggle("hidden", isScan);
  if (!isScan) stopScanner();
  if (!isScan) refreshList();
}

// ============ 扫码签到 ============
let stream = null;
let scanning = false;
let lastHit = { text: null, at: 0 };
const video = document.getElementById("video");
const scanResult = document.getElementById("scanResult");
const btnToggleScan = document.getElementById("btnToggleScan");
const canvas = document.createElement("canvas");
const ctx2d = canvas.getContext("2d", { willReadFrequently: true });

btnToggleScan.addEventListener("click", () => {
  if (scanning) stopScanner();
  else startScanner();
});

async function startScanner() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
  } catch (err) {
    showScan("无法打开摄像头（需 HTTPS 或 localhost 环境），请用手动补签", "error");
    return;
  }
  video.srcObject = stream;
  await video.play();
  document.getElementById("scannerWrap").classList.remove("hidden");
  btnToggleScan.textContent = "停止扫码";
  scanning = true;
  requestAnimationFrame(tickScan);
}

function stopScanner() {
  scanning = false;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  document.getElementById("scannerWrap").classList.add("hidden");
  btnToggleScan.textContent = "开启摄像头扫码";
}

function tickScan() {
  if (!scanning) return;
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
    if (code && code.data) {
      const now = Date.now();
      // 同一码 3 秒内不重复提交
      if (code.data !== lastHit.text || now - lastHit.at > 3000) {
        lastHit = { text: code.data, at: now };
        doCheckin({ token: code.data });
      }
    }
  }
  requestAnimationFrame(tickScan);
}

function showScan(text, type) {
  scanResult.textContent = text;
  scanResult.className = `scanner-result show ${type}`;
}

async function doCheckin(payload) {
  try {
    const r = await api(`/api/admin/${encodeURIComponent(eventId)}/checkin`, {
      method: "POST",
      token: sessionToken,
      body: payload,
    });
    if (r.already_checked) {
      showScan(`⚠️ ${r.name} 已于 ${r.checked_in_at} 签到过`, "warn");
    } else {
      showScan(`✅ ${r.name} 签到成功`, "ok");
      beep();
    }
    refreshStatsOnly();
  } catch (err) {
    showScan(`❌ ${err.message}`, "error");
  }
}

// 签到后只更新统计数字（不整表刷新，避免打断扫码）
async function refreshStatsOnly() {
  try {
    const r = await api(`/api/admin/${encodeURIComponent(eventId)}/signups`, { token: sessionToken });
    document.getElementById("stTotal").textContent = r.stats.total;
    document.getElementById("stChecked").textContent = r.stats.checked;
    document.getElementById("stUnchecked").textContent = r.stats.unchecked;
  } catch { /* ignore */ }
}

function beep() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g);
    g.connect(ac.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.25);
    o.start();
    o.stop(ac.currentTime + 0.25);
  } catch { /* ignore */ }
}

// 手动补签
document.getElementById("btnManual").addEventListener("click", () => {
  const phone = document.getElementById("fManualPhone").value.trim();
  if (!phone) return showScan("请输入手机号", "error");
  doCheckin({ phone });
  document.getElementById("fManualPhone").value = "";
});

// ============ 自动进入：优先账号免 PIN，其次 legacy session，最后 PIN 登录 ============
if (eventId && adminKey && sessionToken) {
  // legacy 恢复
  api(`/api/admin/${encodeURIComponent(eventId)}/signups`, { token: sessionToken })
    .then((r) => enterMain(r.event))
    .catch(() => {
      sessionStorage.removeItem(`es-session-${eventId}`);
      sessionToken = null;
      tryAccountEntry();
    });
} else if (eventId) {
  tryAccountEntry();
}

// 账号已登录且拥有本活动 → 免输 PIN 直接进；否则回退到 PIN 登录（缺 key 则提示无效链接）
async function tryAccountEntry() {
  try {
    const me = await api("/api/account/me");
    if (me && me.account) {
      const r = await api(`/api/admin/${encodeURIComponent(eventId)}/signups`);
      enterMain(r.event);
      return;
    }
  } catch { /* 未登录或非 owner */ }
  showPinLogin();
}

function showPinLogin() {
  if (!adminKey) {
    document.getElementById("loginCard").classList.add("hidden");
    document.getElementById("badLink").classList.remove("hidden");
  } else {
    document.getElementById("loginCard").classList.remove("hidden");
  }
}

// ============ 编辑 / 归档 / 删除 ============
const editModal = document.getElementById("editModal");
const editMsg = document.getElementById("editMsg");

function fmtToInput(t) {
  return t ? String(t).replace(" ", "T") : "";
}

function openEdit() {
  if (!currentEvent) return;
  document.getElementById("efName").value = currentEvent.name || "";
  document.getElementById("efTime").value = fmtToInput(currentEvent.event_time);
  document.getElementById("efLocation").value = currentEvent.location || "";
  document.getElementById("efDesc").value = currentEvent.description || "";
  document.getElementById("efCapacity").value = currentEvent.capacity || 1;
  hideMsg(editMsg);
  editModal.classList.remove("hidden");
}

function closeEdit() { editModal.classList.add("hidden"); }

document.getElementById("btnEdit").addEventListener("click", openEdit);
document.getElementById("btnCancelEdit").addEventListener("click", closeEdit);
editModal.addEventListener("click", (e) => { if (e.target === editModal) closeEdit(); });

document.getElementById("btnSaveEdit").addEventListener("click", async () => {
  if (!currentEvent) return;
  const name = document.getElementById("efName").value.trim();
  const timeRaw = document.getElementById("efTime").value;
  const location_ = document.getElementById("efLocation").value.trim();
  const description = document.getElementById("efDesc").value.trim();
  const capacity = Number(document.getElementById("efCapacity").value);

  if (name.length < 2) return showMsg(editMsg, "请填写活动名称（至少 2 字）");
  if (!timeRaw) return showMsg(editMsg, "请选择活动时间");
  if (!Number.isInteger(capacity) || capacity < 1) return showMsg(editMsg, "名额需为正整数");

  const btn = document.getElementById("btnSaveEdit");
  btn.disabled = true;
  try {
    const r = await api(`/api/events/${encodeURIComponent(eventId)}`, {
      method: "PUT",
      token: sessionToken,
      body: {
        name,
        event_time: timeRaw.replace("T", " "),
        location: location_,
        description,
        capacity,
      },
    });
    currentEvent = r.event;
    renderEvent(r.event);
    closeEdit();
  } catch (err) {
    showMsg(editMsg, err.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btnArchive").addEventListener("click", async () => {
  if (!currentEvent) return;
  const next = !currentEvent.archived;
  try {
    const r = await api(`/api/events/${encodeURIComponent(eventId)}`, {
      method: "PUT",
      token: sessionToken,
      body: { archived: next },
    });
    currentEvent = { ...currentEvent, archived: next };
    renderEvent(currentEvent);
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("btnDelete").addEventListener("click", async () => {
  if (!currentEvent) return;
  if (!confirm("确定删除该活动？删除后将从列表隐藏（数据保留，可恢复）。")) return;
  try {
    await api(`/api/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      token: sessionToken,
    });
    alert("活动已删除");
    location.href = "/";
  } catch (err) {
    alert(err.message);
  }
});
