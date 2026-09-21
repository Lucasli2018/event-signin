# -*- coding: utf-8 -*-
# 生成 event-signin 品牌 OG 分享图（1200x630），珊瑚橙主题
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
OUT = r"D:/gitee/event-signin/public/og-default.png"

# ---- 1. 对角珊瑚橙渐变（用 2x2 角点放大插值）----
grad = Image.new("RGB", (2, 2))
grad.putpixel((0, 0), (255, 176, 138))   # TL 浅
grad.putpixel((1, 0), (255, 138, 91))    # TR
grad.putpixel((0, 1), (255, 122, 69))    # BL
grad.putpixel((1, 1), (255, 90, 46))     # BR 深
base = grad.resize((W, H), Image.BICUBIC)

# ---- 2. 装饰：半透明白圆 ----
deco = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(deco)
d.ellipse([W - 260, -140, W + 140, 260], fill=(255, 255, 255, 28))
d.ellipse([-160, H - 220, 200, H + 140], fill=(255, 255, 255, 28))
d.ellipse([W - 120, H - 120, W + 120, H + 120], fill=(255, 255, 255, 20))
base = Image.alpha_composite(base.convert("RGBA"), deco)

draw = ImageDraw.Draw(base)

MSYH = r"C:/Windows/Fonts/msyh.ttc"
MSYHBD = r"C:/Windows/Fonts/msyhbd.ttc"

def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.truetype(MSYH, size)

f_brand = font(MSYHBD, 74)
f_tag = font(MSYH, 38)
f_small = font(MSYH, 26)

def center_text(txt, fnt, y, fill):
    bbox = draw.textbbox((0, 0), txt, font=fnt)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    draw.text(((W - tw) / 2 - bbox[0], y - th / 2 - bbox[1]), txt, font=fnt, fill=fill)
    return th

# ---- 3. 白色圆角 logo 方块 + 珊瑚橙对勾 ----
lx, ly, ls, r = 0, 0, 150, 44
lx = W // 2 - ls // 2
ly = 120
# 投影
shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.rounded_rectangle([lx - 4, ly - 2, lx + ls + 4, ly + ls + 10], radius=r, fill=(150, 60, 20, 70))
shadow = shadow.filter(__import__("PIL.ImageFilter", fromlist=["GaussianBlur"]).GaussianBlur(12))
base = Image.alpha_composite(base, shadow)
draw = ImageDraw.Draw(base)

draw.rounded_rectangle([lx, ly, lx + ls, ly + ls], radius=r, fill=(255, 255, 255, 255))
# 对勾
ck = (255, 107, 61, 255)
lw = 15
p1 = (lx + 40, ly + 78)
p2 = (lx + 64, ly + 103)
p3 = (lx + 112, ly + 48)
for a, b in ((p1, p2), (p2, p3)):
    draw.line([a, b], fill=ck, width=lw)
for pt in (p1, p2, p3):
    draw.ellipse([pt[0] - lw // 2, pt[1] - lw // 2, pt[0] + lw // 2, pt[1] + lw // 2], fill=ck)

# ---- 4. 文案 ----
center_text("活动报名签到", f_brand, 355, (255, 255, 255, 255))
center_text("社区活动 · 扫码报名 · 现场签到 · 一键导出名单", f_tag, 440, (255, 245, 240, 235))

# 底部小字
host = "Cloudflare Pages + D1"
center_text(host, f_small, 545, (255, 235, 226, 190))

out = base.convert("RGB")
out.save(OUT, "PNG", optimize=True)
print("saved", OUT, out.size)
