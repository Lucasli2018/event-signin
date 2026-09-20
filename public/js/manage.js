// 管理页：PIN 登录 → 名单 / 扫码签到 / 导出 / 截止报名
const eventId = getQuery("id");
const adminKey = getQuery("key");
let sessionToken = sessionStorage.getItem(`es-session-${eventId}`) || null;

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
  const url = `/api/admin/${encodeURIComponent(eventId)}/export?token=${encodeURIComponent(sessionToken)}`;
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

// ============ 自动恢复会话 ============
if (eventId && adminKey && sessionToken) {
  api(`/api/admin/${encodeURIComponent(eventId)}/signups`, { token: sessionToken })
    .then((r) => enterMain(r.event))
    .catch(() => {
      sessionStorage.removeItem(`es-session-${eventId}`);
      sessionToken = null;
    });
}
