// 活动广场：拉取公开活动列表，支持搜索 / 状态筛选 / 排序 / 仅看有名额 / 加载更多。
const PAGE_SIZE = 20;

const state = {
  q: "",
  status: "all",
  sort: "time_asc",
  hasSpots: false,
  offset: 0,
  loading: false,
  done: false,      // 是否已无更多
  total: 0,
};

const listWrap = document.getElementById("listWrap");
const emptyTip = document.getElementById("emptyTip");
const loadingTip = document.getElementById("loadingTip");
const plazaCount = document.getElementById("plazaCount");
const btnMore = document.getElementById("btnMore");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// 判断活动是否已结束（按本地时间比较）
function isPast(eventTime) {
  if (!eventTime) return false;
  const t = new Date(String(eventTime).replace(" ", "T"));
  return !isNaN(t.getTime()) && t.getTime() < Date.now();
}

function statusBadges(ev) {
  const past = isPast(ev.event_time);
  let reg, regClass;
  if (ev.closed) { reg = "已截止"; regClass = "closed"; }
  else if (past) { reg = "已结束"; regClass = "muted"; }
  else { reg = "报名中"; regClass = "active"; }
  const timeTag = past
    ? '<span class="badge unchecked">已结束</span>'
    : '<span class="badge checked">即将开始</span>';
  return `<span class="status-badge ${regClass}">${reg}</span>${timeTag}`;
}

function cardHtml(ev) {
  const remain = ev.remaining;
  const remainText = ev.closed
    ? "报名已截止"
    : remain > 0 ? `剩余 ${remain} / ${ev.capacity}` : "名额已满";
  const desc = ev.description
    ? `<div class="pc-desc"></div>`
    : "";
  const loc = ev.location
    ? `<div class="meta-row"><span class="icon">📍</span><span class="pc-loc"></span></div>`
    : "";
  return `
    <a class="plaza-card" href="/e.html?id=${encodeURIComponent(ev.id)}">
      <div class="pc-head">
        <div class="pc-name"></div>
        <div class="pc-badges">${statusBadges(ev)}</div>
      </div>
      <div class="meta-row"><span class="icon">🕐</span><span class="pc-time"></span></div>
      ${loc}
      ${desc}
      <div class="pc-foot">
        <span class="pc-remain ${remain > 0 && !ev.closed ? "ok" : ""}"></span>
        <span class="pc-organizer"></span>
      </div>
    </a>`;
}

function fillCard(el, ev) {
  el.querySelector(".pc-name").textContent = ev.name;
  el.querySelector(".pc-time").textContent = ev.event_time || "-";
  const locEl = el.querySelector(".pc-loc");
  if (locEl) locEl.textContent = ev.location;
  const descEl = el.querySelector(".pc-desc");
  if (descEl) descEl.textContent = ev.description;
  const remainEl = el.querySelector(".pc-remain");
  remainEl.textContent = ev.closed
    ? "报名已截止"
    : ev.remaining > 0 ? `剩余 ${ev.remaining} / ${ev.capacity}` : "名额已满";
  el.querySelector(".pc-organizer").textContent = "组织者：" + (ev.organizer || "匿名组织者");
}

function appendEvents(events) {
  for (const ev of events) {
    const tmp = document.createElement("div");
    tmp.innerHTML = cardHtml(ev).trim();
    const card = tmp.querySelector(".plaza-card");
    fillCard(card, ev);
    listWrap.appendChild(card);
  }
}

function buildQuery() {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.status && state.status !== "all") p.set("status", state.status);
  if (state.hasSpots) p.set("hasSpots", "1");
  p.set("sort", state.sort);
  p.set("limit", String(PAGE_SIZE));
  p.set("offset", String(state.offset));
  return p.toString();
}

async function load(reset) {
  if (state.loading) return;
  if (reset) {
    state.offset = 0;
    state.done = false;
    listWrap.innerHTML = "";
  }
  if (state.done) return;

  state.loading = true;
  loadingTip.classList.remove("hidden");
  btnMore.classList.add("hidden");
  emptyTip.classList.add("hidden");

  try {
    const data = await api(`/api/plaza?${buildQuery()}`);
    const events = data.events || [];
    state.total = data.total || 0;
    state.offset += events.length;
    if (events.length < PAGE_SIZE) state.done = true;

    appendEvents(events);

    // 计数文案
    plazaCount.textContent = `共 ${state.total} 个活动`;

    const hasAny = listWrap.children.length > 0;
    emptyTip.classList.toggle("hidden", hasAny);
    btnMore.classList.toggle("hidden", state.done || !hasAny);
  } catch (err) {
    plazaCount.textContent = "";
    if (!listWrap.children.length) emptyTip.classList.remove("hidden");
    alert(err.message || "加载失败");
  } finally {
    state.loading = false;
    loadingTip.classList.add("hidden");
  }
}

// ============ 交互绑定 ============
document.getElementById("btnSearch").addEventListener("click", () => {
  state.q = document.getElementById("fQ").value.trim();
  load(true);
});
document.getElementById("fQ").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    state.q = e.target.value.trim();
    load(true);
  }
});
document.getElementById("fQ").addEventListener("input", (e) => {
  // 清空关键词时即时回到全部
  if (e.target.value.trim() === "" && state.q !== "") {
    state.q = "";
    load(true);
  }
});

document.querySelectorAll("#statusChips .chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#statusChips .chip").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.status = btn.dataset.status;
    load(true);
  });
});

document.getElementById("sortSelect").addEventListener("change", (e) => {
  state.sort = e.target.value;
  load(true);
});

document.getElementById("fHasSpots").addEventListener("change", (e) => {
  state.hasSpots = e.target.checked;
  load(true);
});

btnMore.addEventListener("click", () => load(false));

// 首次加载
load(true);
