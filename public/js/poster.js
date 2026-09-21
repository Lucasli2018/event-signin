// 分享海报生成器
// 用 Canvas 绘制珊瑚橙活动海报（含报名二维码），支持保存 PNG / 复制报名链接。
// 依赖：vendor/qrcode.min.js（QRCode）、api.js（copyText）。
// 用法：Poster.open({ name, eventTime, location, description, capacity, taken, url })
(function () {
  "use strict";

  var BRAND_1 = "#FF8A5B"; // 珊瑚橙渐变起
  var BRAND_2 = "#FF6B3D"; // 珊瑚橙渐变止
  var INK = "#1F2937";
  var MUTED = "#6B7280";
  var SITE = location.origin;

  // 高清倍率：2~3x，下载出来的图更锐利
  var S = Math.min(3, Math.max(2, Math.ceil(window.devicePixelRatio || 2)));

  var FONT = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif";

  // ---------- 绘图小工具 ----------
  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // 按字宽换行（中文逐字，英文/数字按空白优先）
  function wrapText(ctx, text, maxWidth) {
    var chars = Array.from(String(text || ""));
    var lines = [];
    var line = "";
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = chars[i];
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // 把 qrcode.min.js 的渲染结果转成可绘制图像（桌面端出 canvas，部分 Android 出 img）
  function renderQR(text, px) {
    return new Promise(function (resolve, reject) {
      var holder = document.createElement("div");
      holder.style.cssText = "position:absolute;left:-99999px;top:0;width:" + px + "px;height:" + px + "px;";
      document.body.appendChild(holder);
      try {
        new QRCode(holder, {
          text: text,
          width: px,
          height: px,
          correctLevel: QRCode.CorrectLevel.M,
        });
      } catch (e) {
        document.body.removeChild(holder);
        return reject(e);
      }
      requestAnimationFrame(function () {
        var cv = holder.querySelector("canvas");
        if (cv) {
          document.body.removeChild(holder);
          return resolve(cv);
        }
        var img = holder.querySelector("img");
        if (img && img.src) {
          var im = new Image();
          im.onload = function () { document.body.removeChild(holder); resolve(im); };
          im.onerror = function (e) { document.body.removeChild(holder); reject(e); };
          im.src = img.src;
          return;
        }
        document.body.removeChild(holder);
        reject(new Error("二维码渲染失败"));
      });
    });
  }

  // ---------- 绘制海报 ----------
  async function buildCanvas(data) {
    var W = 360;
    var PAD = 22;
    var CARD_W = W - PAD * 2;
    var CARD_X = PAD;
    var CARD_R = 18;
    var CX_PAD = 20;
    var innerW = CARD_W - CX_PAD * 2;

    var qrSize = 164;

    // --- 测量文本 ---
    var m = document.createElement("canvas").getContext("2d");
    m.font = "600 21px " + FONT;
    var nameLines = wrapText(m, data.name || "活动报名", innerW).slice(0, 3);

    m.font = "14px " + FONT;
    var meta = [];
    if (data.eventTime) meta.push({ icon: "🕐", text: String(data.eventTime) });
    if (data.location) meta.push({ icon: "📍", text: String(data.location) });
    if (data.description) {
      wrapText(m, data.description, innerW - 22).slice(0, 3).forEach(function (l) {
        meta.push({ icon: "📝", text: l, _cont: meta.length && meta[meta.length - 1].icon === "📝" });
      });
    }

    var hasStats = data.capacity > 0 && data.taken !== undefined && data.taken !== null;

    // --- 计算卡片高度 ---
    var headH = 20 + 52 + 9 + 16;                       // 上边距 + logo + 间隙 + 品牌字
    var nameH = 12 + nameLines.length * 28;
    var metaH = meta.length ? 14 + meta.length * 23 : 0;
    var statsH = hasStats ? 16 + 30 : 0;
    var qrBoxH = 14 + qrSize + 8 + 24 + 12;             // 内边距 + 码 + 间隙 + 说明 + 下边距
    var qrH = 18 + qrBoxH;
    var footH = 10 + 18;
    var cardH = headH + nameH + metaH + statsH + qrH + footH + 20;

    var H = PAD * 2 + cardH;

    // --- 建画布 ---
    var canvas = document.createElement("canvas");
    canvas.width = Math.round(W * S);
    canvas.height = Math.round(H * S);
    var ctx = canvas.getContext("2d");
    ctx.scale(S, S);
    ctx.textBaseline = "alphabetic";

    // 背景：珊瑚橙渐变 + 角落装饰圆
    var bg = ctx.createLinearGradient(0, 0, W * 0.6, H);
    bg.addColorStop(0, "#FFA377");
    bg.addColorStop(0.55, BRAND_1);
    bg.addColorStop(1, BRAND_2);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(W - 30, 34, 78, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(18, H - 40, 56, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 白色卡片（柔和投影）
    ctx.save();
    ctx.shadowColor = "rgba(120, 45, 10, .22)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, CARD_X, PAD, CARD_W, cardH, CARD_R);
    ctx.fill();
    ctx.restore();

    var cy = PAD;
    var yy = cy + 20;
    ctx.textAlign = "center";

    // logo：珊瑚橙圆角方块 + 白色对勾
    var lx = W / 2 - 26, ly = yy;
    var lg = ctx.createLinearGradient(lx, ly, lx + 52, ly + 52);
    lg.addColorStop(0, BRAND_1);
    lg.addColorStop(1, BRAND_2);
    ctx.fillStyle = lg;
    roundRect(ctx, lx, ly, 52, 52, 15);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lx + 15, ly + 27);
    ctx.lineTo(lx + 23, ly + 36);
    ctx.lineTo(lx + 38, ly + 18);
    ctx.stroke();
    yy += 52 + 9;

    // 品牌名
    ctx.fillStyle = BRAND_2;
    ctx.font = "600 13px " + FONT;
    ctx.fillText("活动报名签到", W / 2, yy + 12);
    yy += 16 + 12;

    // 活动名称
    ctx.fillStyle = INK;
    ctx.font = "600 21px " + FONT;
    nameLines.forEach(function (l, i) {
      ctx.fillText(l, W / 2, yy + 21 + i * 28);
    });
    yy += nameLines.length * 28 + 14;

    // 元信息（左对齐）
    if (meta.length) {
      ctx.textAlign = "left";
      ctx.font = "14px " + FONT;
      meta.forEach(function (row, i) {
        var baseY = yy + 16 + i * 23;
        ctx.fillStyle = row._cont ? MUTED : INK;
        ctx.fillText(row._cont ? "  " : row.icon + "  ", CARD_X + CX_PAD, baseY);
        ctx.fillStyle = INK;
        ctx.fillText(row.text, CARD_X + CX_PAD + 25, baseY);
      });
      yy += meta.length * 23 + 14;
    }

    // 报名进度胶囊
    if (hasStats) {
      var pillW = 152, pillH = 30;
      var px0 = W / 2 - pillW / 2;
      ctx.fillStyle = "#FFF1EA";
      roundRect(ctx, px0, yy, pillW, pillH, 15);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.fillStyle = BRAND_2;
      ctx.font = "600 14px " + FONT;
      var remain = Math.max(0, (data.capacity || 0) - (data.taken || 0));
      ctx.fillText("已报 " + (data.taken || 0) + " / " + data.capacity + " · 余 " + remain, W / 2, yy + 20);
      yy += 30 + 16;
    }

    // 二维码区块
    var boxW = qrSize + 28;
    var boxX = W / 2 - boxW / 2;
    ctx.fillStyle = "#FFF8F4";
    roundRect(ctx, boxX, yy, boxW, qrBoxH, 14);
    ctx.fill();
    ctx.strokeStyle = "#FFE2D5";
    ctx.lineWidth = 1;
    roundRect(ctx, boxX, yy, boxW, qrBoxH, 14);
    ctx.stroke();

    var qrX = W / 2 - qrSize / 2;
    var qrY = yy + 14;
    try {
      var qrImg = await renderQR(data.url, Math.round(qrSize * S));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
      ctx.imageSmoothingEnabled = true;
    } catch (e) {
      // 兜底：留白框
      ctx.fillStyle = "#fff";
      ctx.fillRect(qrX, qrY, qrSize, qrSize);
      ctx.fillStyle = MUTED;
      ctx.textAlign = "center";
      ctx.font = "13px " + FONT;
      ctx.fillText("二维码生成失败", W / 2, qrY + qrSize / 2);
    }

    ctx.textAlign = "center";
    ctx.fillStyle = BRAND_2;
    ctx.font = "600 13px " + FONT;
    ctx.fillText("扫码或长按识别二维码报名", W / 2, qrY + qrSize + 22);
    yy += qrBoxH + 12;

    // 页脚
    ctx.fillStyle = "#9CA3AF";
    ctx.font = "12px " + FONT;
    var host = SITE.replace(/^https?:\/\//, "");
    ctx.fillText("由 活动报名签到 提供 · " + host, W / 2, yy + 12);

    return canvas;
  }

  // ---------- 遮罩层 ----------
  var overlay = null;
  var lastCanvas = null;
  var lastName = "活动海报";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    var el = document.createElement("div");
    el.className = "poster-overlay hidden";
    el.id = "posterOverlay";
    el.innerHTML =
      '<div class="poster-modal">' +
      '  <div class="poster-head"><span>📣 分享海报</span><button class="poster-x" id="posterClose" aria-label="关闭">✕</button></div>' +
      '  <div class="poster-canvas-wrap"><canvas id="posterCanvas"></canvas></div>' +
      '  <div class="poster-actions">' +
      '    <button class="btn coral" id="posterSave">保存图片</button>' +
      '    <button class="btn secondary" id="posterCopy">复制报名链接</button>' +
      '  </div>' +
      '  <div class="poster-tip">手机端可长按图片保存，再分享到微信群 / 朋友圈</div>' +
      "</div>";
    document.body.appendChild(el);

    el.addEventListener("click", function (e) {
      if (e.target === el) close();
    });
    el.querySelector("#posterClose").addEventListener("click", close);

    el.querySelector("#posterSave").addEventListener("click", function () {
      if (!lastCanvas) return;
      var btn = this;
      try {
        var url = lastCanvas.toDataURL("image/png");
        var a = document.createElement("a");
        a.href = url;
        a.download = lastName + "-海报.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
        btn.textContent = "已保存 ✓";
        setTimeout(function () { btn.textContent = "保存图片"; }, 1600);
      } catch (err) {
        showMsgFallback("保存失败，请长按图片保存");
      }
    });

    el.querySelector("#posterCopy").addEventListener("click", function () {
      copyText(currentUrl, this);
    });

    overlay = el;
    return el;
  }

  var currentUrl = "";

  function showMsgFallback(text) {
    if (window.alert) window.alert(text);
  }

  function close() {
    if (overlay) overlay.classList.add("hidden");
  }

  // ---------- 对外接口 ----------
  var Poster = {
    open: async function (data) {
      data = data || {};
      var url = data.url || (SITE + "/e.html" + (data.id ? "?id=" + encodeURIComponent(data.id) : ""));
      currentUrl = url;
      lastName = (data.name || "活动") + "";
      var el = ensureOverlay();
      el.classList.remove("hidden");

      var wrap = el.querySelector(".poster-canvas-wrap");
      var old = wrap.querySelector("canvas");
      if (old) old.remove();
      var loading = document.createElement("div");
      loading.className = "poster-loading";
      loading.textContent = "正在生成海报…";
      wrap.appendChild(loading);

      try {
        var canvas = await buildCanvas({
          name: data.name,
          eventTime: data.eventTime,
          location: data.location,
          description: data.description,
          capacity: data.capacity,
          taken: data.taken,
          url: url,
        });
        lastCanvas = canvas;
        wrap.querySelector(".poster-loading").remove();
        wrap.appendChild(canvas);
      } catch (err) {
        loading.textContent = "海报生成失败：" + (err && err.message ? err.message : err);
        console.error("[poster]", err);
      }
    },
    close: close,
  };

  window.Poster = Poster;
})();
