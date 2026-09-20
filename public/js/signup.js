// 报名页：加载活动信息 → 提交报名 → 展示个人签到二维码
const eventId = getQuery("id");
const msg = document.getElementById("msg");

function showSuccess(token, name, duplicated) {
  const payload = JSON.stringify({ t: token });
  new QRCode(document.getElementById("qrcode"), {
    text: payload,
    width: 220,
    height: 220,
    correctLevel: QRCode.CorrectLevel.M,
  });
  document.getElementById("qrName").textContent = `${name} 的签到码`;
  document.getElementById("tokenText").textContent = `签到码：${token}`;
  if (duplicated) {
    document.getElementById("dupTip").innerHTML =
      "该手机号已报过名，这是你的签到二维码。<b>建议截图保存本页。</b>";
  }
  document.getElementById("formCard").classList.add("hidden");
  document.getElementById("successCard").classList.remove("hidden");
  window.scrollTo(0, 0);
}

async function loadEvent() {
  if (!eventId) {
    document.getElementById("notFound").classList.remove("hidden");
    return;
  }
  try {
    const ev = await api(`/api/events/${encodeURIComponent(eventId)}`);
    document.title = `${ev.name} - 活动报名`;

    document.getElementById("evName").textContent = ev.name;
    document.getElementById("evTime").textContent = ev.event_time;
    if (ev.location) {
      document.getElementById("evLocRow").style.display = "";
      document.getElementById("evLoc").textContent = ev.location;
    }
    if (ev.description) {
      document.getElementById("evDescRow").style.display = "";
      document.getElementById("evDesc").textContent = ev.description;
    }
    const pct = ev.capacity ? Math.min(100, (ev.taken / ev.capacity) * 100) : 0;
    document.getElementById("fill").style.width = pct + "%";
    document.getElementById("takenText").textContent = `已报 ${ev.taken}/${ev.capacity}`;
    document.getElementById("remainText").textContent = ev.remaining > 0 ? `剩余 ${ev.remaining}` : "已满";

    document.getElementById("eventCard").style.display = "";

    if (ev.closed || ev.remaining <= 0) {
      document.getElementById("closedCard").classList.remove("hidden");
      if (ev.remaining <= 0 && !ev.closed) {
        document.getElementById("closedReason").textContent = "名额已满。";
      } else {
        document.getElementById("closedReason").textContent = "组织者已截止报名。";
      }
    } else {
      document.getElementById("formCard").style.display = "";
    }
  } catch (err) {
    if (err.status === 404) {
      document.getElementById("notFound").classList.remove("hidden");
    } else {
      document.getElementById("notFound").classList.remove("hidden");
      document.getElementById("notFound").textContent = err.message;
    }
  }
}

document.getElementById("btnSignup").addEventListener("click", async () => {
  hideMsg(msg);
  const name = document.getElementById("fName").value.trim();
  const phone = document.getElementById("fPhone").value.trim();
  if (!name) return showMsg(msg, "请填写姓名");
  if (!phone) return showMsg(msg, "请填写手机号");

  const btn = document.getElementById("btnSignup");
  btn.disabled = true;
  btn.textContent = "提交中…";
  try {
    const r = await api(`/api/events/${encodeURIComponent(eventId)}/signup`, {
      method: "POST",
      body: { name, phone },
    });
    showSuccess(r.token, r.name, !!r.duplicated);
  } catch (err) {
    showMsg(msg, err.message);
    if (err.status === 410) {
      setTimeout(() => location.reload(), 1500);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "立即报名";
  }
});

loadEvent();
