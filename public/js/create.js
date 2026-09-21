// 创建活动页
const msg = document.getElementById("msg");
const btn = document.getElementById("btnCreate");

btn.addEventListener("click", async () => {
  hideMsg(msg);

  const name = document.getElementById("fName").value.trim();
  const timeRaw = document.getElementById("fTime").value; // 'YYYY-MM-DDTHH:MM'
  const location_ = document.getElementById("fLocation").value.trim();
  const description = document.getElementById("fDesc").value.trim();
  const capacity = Number(document.getElementById("fCapacity").value);
  const pin = document.getElementById("fPin").value.trim();

  const fields = {};
  if (document.getElementById("fFieldCompany").checked) fields.company = true;
  if (document.getElementById("fFieldRemark").checked) fields.remark = true;

  if (name.length < 2) return showMsg(msg, "请填写活动名称（至少 2 字）");
  if (!timeRaw) return showMsg(msg, "请选择活动时间");
  if (!Number.isInteger(capacity) || capacity < 1) return showMsg(msg, "名额需为正整数");
  if (!/^\d{6,8}$/.test(pin)) return showMsg(msg, "PIN 需为 6-8 位数字");

  const eventTime = timeRaw.replace("T", " ");

  btn.disabled = true;
  btn.textContent = "创建中…";
  try {
    const r = await api("/api/events", {
      method: "POST",
      body: { name, event_time: eventTime, location: location_, description, capacity, pin, fields },
    });

    const origin = window.location.origin;
    const signupUrl = origin + r.signup_path;
    const manageUrl = origin + r.manage_path;

    document.getElementById("signupUrl").textContent = signupUrl;
    document.getElementById("manageUrl").textContent = manageUrl;
    document.getElementById("goManage").href = r.manage_path;

    document.getElementById("copySignup").onclick = (e) => copyText(signupUrl, e.target);
    document.getElementById("copyManage").onclick = (e) => copyText(manageUrl, e.target);

    new QRCode(document.getElementById("qrcode"), {
      text: signupUrl,
      width: 200,
      height: 200,
      correctLevel: QRCode.CorrectLevel.M,
    });

    document.getElementById("createCard").classList.add("hidden");
    document.getElementById("doneCard").classList.remove("hidden");
    window.scrollTo(0, 0);
  } catch (err) {
    showMsg(msg, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "创建活动";
  }
});
