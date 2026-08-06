# -*- coding: utf-8 -*-
# แก้ label/icon แล้วรัน `python gen-richmenu-images.py` ใหม่ จะได้รูปทับของเดิมใน richmenu-assets/ —
# หลังแก้รูปต้องรัน scripts/setup-richmenu.mjs ใหม่ด้วย ไม่งั้น LINE ยังใช้รูปเก่าที่อัพโหลดไปแล้วอยู่
#
# ไล่สีตามธีมหลัก PAYI (--payi-gradient-primary: #2563eb -> #34d399) + การ์ดโค้งมน + ไอคอนอยู่ในวงกลม
# soft badge + ประกายดาวตกแต่งพื้นหลัง ตัวอักษรใหญ่ อ่านง่าย ตามที่ owner ขอ (อ้างอิงสไตล์เมนู SCB Connect)
import math
import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "richmenu-assets")
FONT_PATH = r"C:\Windows\Fonts\tahomabd.ttf"
EMOJI_FONT_PATH = r"C:\Windows\Fonts\seguiemj.ttf"

BRAND_START = (37, 99, 235)   # --payi-mint #2563eb
BRAND_END = (52, 211, 153)    # #34d399
CARD_BG = (255, 255, 255, 242)
BADGE_BG = (233, 244, 255, 255)
LABEL_COLOR = (11, 30, 56)
SHADOW_COLOR = (8, 20, 38, 80)
SPARKLE_COLOR = (255, 255, 255, 130)

def diagonal_gradient(size, color1, color2):
    w, h = size
    diag = int((w ** 2 + h ** 2) ** 0.5)
    base = Image.new("L", (diag, diag), 0)
    for i in range(diag):
        v = int(255 * i / diag)
        ImageDraw.Draw(base).line([(0, i), (diag, i)], fill=v)
    rotated = base.rotate(-45, expand=True, resample=Image.BICUBIC)
    rw, rh = rotated.size
    left, top = (rw - w) // 2, (rh - h) // 2
    mask = rotated.crop((left, top, left + w, top + h))
    c1 = Image.new("RGB", size, color1)
    c2 = Image.new("RGB", size, color2)
    return Image.composite(c2, c1, mask)

def draw_sparkle(draw, cx, cy, size, color):
    # ดาว 4 แฉกเรียบๆ (ไม่ใช่ emoji) วาดเองด้วยเส้น กันพื้นหลังดูโล่งเกินไป
    draw.line([(cx - size, cy), (cx + size, cy)], fill=color, width=max(2, size // 8))
    draw.line([(cx, cy - size), (cx, cy + size)], fill=color, width=max(2, size // 8))
    d = size * 0.5
    draw.line([(cx - d, cy - d), (cx + d, cy + d)], fill=color, width=max(1, size // 12))
    draw.line([(cx - d, cy + d), (cx + d, cy - d)], fill=color, width=max(1, size // 12))

def rounded_card(draw, box, radius, fill, shadow_offset=7):
    x0, y0, x1, y1 = box
    draw.rounded_rectangle([x0 + shadow_offset, y0 + shadow_offset, x1 + shadow_offset, y1 + shadow_offset], radius=radius, fill=SHADOW_COLOR)
    draw.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=fill)

def draw_grid(filename, width, height, cols, rows, cells, cell_w, cell_h, pad=16):
    bg = diagonal_gradient((width, height), BRAND_START, BRAND_END).convert("RGBA")
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # ประกายดาวกระจายพื้นหลัง มุม/ขอบเท่านั้น กันไปทับปุ่ม
    sparkle_spots = [(40, 40, 14), (width - 50, 34, 10), (30, height - 36, 10),
                      (width - 36, height - 46, 16), (width // 2, 22, 8)]
    for sx, sy, ssize in sparkle_spots:
        draw_sparkle(draw, sx, sy, ssize, SPARKLE_COLOR)

    label_font = ImageFont.truetype(FONT_PATH, 34)
    label_font_small = ImageFont.truetype(FONT_PATH, 28)  # ป้ายยาว (>10 ตัวอักษร) ใช้ตัวเล็กลงกันล้น
    brand_font = ImageFont.truetype(FONT_PATH, 26)
    try:
        emoji_font = ImageFont.truetype(EMOJI_FONT_PATH, 50)
    except Exception:
        emoji_font = label_font

    for i, cell in enumerate(cells):
        col, row = i % cols, i // cols
        x0, y0 = col * cell_w, row * cell_h
        x1, y1 = x0 + cell_w, y0 + cell_h
        box = (x0 + pad, y0 + pad, x1 - pad, y1 - pad)
        cx = x0 + cell_w // 2

        if cell.get("spare"):
            rounded_card(draw, box, 26, (255, 255, 255, 46))
            text = cell["label"]
            bbox = draw.textbbox((0, 0), text, font=brand_font)
            tw = bbox[2] - bbox[0]
            draw.text((cx - tw // 2, y0 + cell_h // 2 - 15), text, font=brand_font, fill=(255, 255, 255, 220))
            continue

        rounded_card(draw, box, 26, CARD_BG)
        icon, label = cell["icon"], cell["label"]

        # วงกลม soft badge หลังไอคอน
        badge_r = 46
        badge_cy = y0 + cell_h // 2 - 48
        draw.ellipse([cx - badge_r, badge_cy - badge_r, cx + badge_r, badge_cy + badge_r], fill=BADGE_BG)
        try:
            ibbox = draw.textbbox((0, 0), icon, font=emoji_font)
            iw, ih = ibbox[2] - ibbox[0], ibbox[3] - ibbox[1]
            draw.text((cx - iw // 2, badge_cy - ih // 2 - ibbox[1]), icon, font=emoji_font, embedded_color=True)
        except Exception:
            pass

        font = label_font_small if len(label) > 9 else label_font
        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        draw.text((cx - tw // 2, y0 + cell_h // 2 + 24), label, font=font, fill=LABEL_COLOR)

    img = Image.alpha_composite(bg, overlay).convert("RGB")
    img.save(os.path.join(OUT_DIR, filename), "PNG")
    print(filename, img.size)

# Boss/Dev full — 1200x810, 3x3 grid (cell 400x270)
full_cells = [
    {"icon": "\U0001F4E6", "label": "แจ้งของเข้า"},
    {"icon": "\U0001F6D2", "label": "สั่งของ"},
    {"icon": "\U0001F4CB", "label": "ของเข้ารอตรวจ"},
    {"icon": "\U0001F4DD", "label": "อนุมัติการลา"},
    {"icon": "\U0001F3D6", "label": "ขอลา"},
    {"icon": "\U0001F310", "label": "เว็บแอพ"},
    {"icon": "\u2753", "label": "ช่วยเหลือ"},
    {"label": "PAYI", "spare": True},
    {"label": "OPS", "spare": True},
]
draw_grid("richmenu-full.png", 1200, 810, 3, 3, full_cells, 400, 270)

# Stock tier — 800x540, 2x2 grid (cell 400x270)
stock_cells = [
    {"icon": "\U0001F4E6", "label": "แจ้งของเข้า"},
    {"icon": "\U0001F3D6", "label": "ขอลา"},
    {"icon": "\U0001F310", "label": "เว็บแอพ"},
    {"icon": "\u2753", "label": "ช่วยเหลือ"},
]
draw_grid("richmenu-stock.png", 800, 540, 2, 2, stock_cells, 400, 270)

# Staff tier — 800x540, 2x2 grid (cell 400x270)
staff_cells = [
    {"icon": "\U0001F3D6", "label": "ขอลา"},
    {"icon": "\U0001F4D6", "label": "เช็คประวัติ"},
    {"icon": "\U0001F4CA", "label": "เช็ควันลาคงเหลือ"},
    {"icon": "\u2753", "label": "ช่วยเหลือ"},
]
draw_grid("richmenu-staff.png", 800, 540, 2, 2, staff_cells, 400, 270)
