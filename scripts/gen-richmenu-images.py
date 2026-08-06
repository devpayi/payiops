# -*- coding: utf-8 -*-
# แก้ label/icon แล้วรัน `python gen-richmenu-images.py` ใหม่ จะได้รูปทับของเดิมใน richmenu-assets/ —
# หลังแก้รูปต้องรัน scripts/setup-richmenu.mjs ใหม่ด้วย ไม่งั้น LINE ยังใช้รูปเก่าที่อัพโหลดไปแล้วอยู่
#
# สีไล่โทน + การ์ดโค้งมน ตาม gradient หลักของธีม PAYI (--payi-gradient-primary: #2563eb -> #34d399)
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "richmenu-assets")
FONT_PATH = r"C:\Windows\Fonts\tahomabd.ttf"
EMOJI_FONT_PATH = r"C:\Windows\Fonts\seguiemj.ttf"

BRAND_START = (37, 99, 235)   # --payi-mint #2563eb
BRAND_END = (52, 211, 153)    # #34d399
CARD_BG = (255, 255, 255, 235)
LABEL_COLOR = (15, 37, 64)
SHADOW_COLOR = (10, 25, 45, 70)

def diagonal_gradient(size, color1, color2):
    w, h = size
    diag = int((w ** 2 + h ** 2) ** 0.5)
    base = Image.new("L", (diag, diag), 0)
    for i in range(diag):
        v = int(255 * i / diag)
        ImageDraw.Draw(base).line([(0, i), (diag, i)], fill=v)
    rotated = base.rotate(-45, expand=True, resample=Image.BICUBIC)
    rw, rh = rotated.size
    left = (rw - w) // 2
    top = (rh - h) // 2
    mask = rotated.crop((left, top, left + w, top + h))
    c1 = Image.new("RGB", size, color1)
    c2 = Image.new("RGB", size, color2)
    return Image.composite(c2, c1, mask)

def rounded_card(draw, box, radius, fill, shadow_offset=6):
    x0, y0, x1, y1 = box
    draw.rounded_rectangle([x0 + shadow_offset, y0 + shadow_offset, x1 + shadow_offset, y1 + shadow_offset], radius=radius, fill=SHADOW_COLOR)
    draw.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=fill)

def draw_grid(filename, width, height, cols, rows, cells, cell_w, cell_h, pad=14):
    bg = diagonal_gradient((width, height), BRAND_START, BRAND_END).convert("RGBA")
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    label_font = ImageFont.truetype(FONT_PATH, 30)
    brand_font = ImageFont.truetype(FONT_PATH, 22)
    try:
        emoji_font = ImageFont.truetype(EMOJI_FONT_PATH, 48)
    except Exception:
        emoji_font = label_font

    for i, cell in enumerate(cells):
        col = i % cols
        row = i // cols
        x0, y0 = col * cell_w, row * cell_h
        x1, y1 = x0 + cell_w, y0 + cell_h
        box = (x0 + pad, y0 + pad, x1 - pad, y1 - pad)
        cx = x0 + cell_w // 2

        if cell.get("spare"):
            rounded_card(draw, box, 24, (255, 255, 255, 40))
            text = cell["label"]
            bbox = draw.textbbox((0, 0), text, font=brand_font)
            tw = bbox[2] - bbox[0]
            draw.text((cx - tw // 2, y0 + cell_h // 2 - 12), text, font=brand_font, fill=(255, 255, 255, 200))
            continue

        rounded_card(draw, box, 24, CARD_BG)
        icon = cell["icon"]
        label = cell["label"]
        try:
            ibbox = draw.textbbox((0, 0), icon, font=emoji_font)
            iw = ibbox[2] - ibbox[0]
            draw.text((cx - iw // 2, y0 + cell_h // 2 - 66), icon, font=emoji_font, embedded_color=True)
        except Exception:
            pass
        bbox = draw.textbbox((0, 0), label, font=label_font)
        tw = bbox[2] - bbox[0]
        draw.text((cx - tw // 2, y0 + cell_h // 2 + 16), label, font=label_font, fill=LABEL_COLOR)

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
