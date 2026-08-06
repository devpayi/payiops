# -*- coding: utf-8 -*-
# แก้ label/icon แล้วรัน `python gen-richmenu-images.py` ใหม่ จะได้รูปทับของเดิมใน richmenu-assets/ —
# หลังแก้รูปต้องรัน scripts/setup-richmenu.mjs ใหม่ด้วย ไม่งั้น LINE ยังใช้รูปเก่าที่อัพโหลดไปแล้วอยู่
#
# โทนม่วง-ชมพู-ขาว ตามภาพอ้างอิงที่ owner ส่งมาเป๊ะๆ, ฟอนต์ Anuphan (โหลดมาจาก Google Fonts repo ไว้ใน
# scripts/fonts/ — ไม่มีในเครื่อง Windows โดย default), ไอคอนลายเส้นวาดเองด้วย PIL primitives (ไม่ใช้ emoji)
# ถ้าแก้พิกัด area ในไฟล์นี้ ต้องไปแก้ areas ใน scripts/setup-richmenu.mjs ให้ตรงกันด้วยเสมอ
import os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "richmenu-assets")
FONT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts", "Anuphan-Variable.ttf")

# โทนม่วง-ชมพู-ขาว เพิ่มสัดส่วนชมพูอีก ~30% ตามที่ owner ขอ (พื้นหลังออกชมพูเด่นกว่าเดิม ไม่ใช่ฟ้า-ม่วงล้วน)
BG_TOP = (255, 209, 232)     # vivid pastel pink
BG_BOTTOM = (222, 195, 250)  # pastel purple (แทนที่ฟ้า-ลาเวนเดอร์เดิม)
HERO_START = (243, 176, 224)  # pink-purple
HERO_END = (167, 139, 250)    # medium purple
HERO_TEXT = (58, 18, 110)     # ม่วงเข้มจัด ใช้กับตัวหนังสือบนพื้นขาว (HERO_END จางเกินไป อ่านยาก)
PILL_START = (91, 33, 182)    # deep purple
PILL_END = (219, 112, 199)    # magenta-pink
CARD_BORDER = (240, 171, 220)
ICON_COLOR = (124, 58, 237)
LABEL_COLOR = (76, 29, 149)   # deep indigo
WHITE = (255, 255, 255)
SHADOW_COLOR = (76, 29, 149, 55)
GLASS_FILL = (255, 255, 255, 190)   # การ์ดกระจกใส เห็นพื้นหลังลอดผ่านนิดๆ
GLASS_HIGHLIGHT = (255, 255, 255, 130)
SPARKLE_COLOR = (255, 255, 255, 210)
CLOUD_COLOR = (255, 255, 255, 200)

# ไอคอนการ์ดล่างให้สีสันต์คนละสีต่อความหมาย (การ์ด/พื้นหลังยังโทนม่วง-ชมพูเดิม แค่ตัวไอคอนสีสดขึ้น)
ICON_COLORS = {
    "box": (234, 140, 24),       # ส้ม
    "cart": (30, 136, 229),      # ฟ้า
    "clipboard": (0, 150, 136),  # เขียวอมฟ้า
    "note_edit": (236, 64, 122), # ชมพูเข้ม
    "beach": (255, 179, 0),      # เหลืองทอง
    "globe": (30, 136, 229),     # ฟ้า
    "question": (229, 57, 53),   # แดงส้ม
    "book": (67, 160, 71),       # เขียว
    "chart": (124, 58, 237),     # ม่วง (เส้นขอบ, บาร์แต่ละแท่งคนละสีในฟังก์ชัน)
}

def font(weight, size):
    f = ImageFont.truetype(FONT_PATH, size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f

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

def paste_gradient_box(base_rgba, box, color1, color2, radius, shadow=True, draw_ctx=None):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    grad = diagonal_gradient((w, h), color1, color2).convert("RGBA")
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    if shadow and draw_ctx is not None:
        off = 7
        draw_ctx.rounded_rectangle([x0 + off, y0 + off, x1 + off, y1 + off], radius=radius, fill=SHADOW_COLOR)
    base_rgba.paste(grad, (x0, y0), mask)

def text_center(draw, cx, y, text, fnt, fill):
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw = bbox[2] - bbox[0]
    draw.text((cx - tw // 2, y), text, font=fnt, fill=fill)
    return bbox[3] - bbox[1]

def fit_font(draw, text, weight, start_size, max_width, min_size=16):
    size = start_size
    while size > min_size:
        f = font(weight, size)
        bbox = draw.textbbox((0, 0), text, font=f)
        if bbox[2] - bbox[0] <= max_width:
            return f
        size -= 2
    return font(weight, min_size)

def draw_sparkle(draw, cx, cy, size, color=SPARKLE_COLOR):
    # ดาว 4 แฉก วาดเองด้วยเส้น (ไม่ใช้ emoji) — ระยิบระยับตกแต่งพื้นหลัง
    draw.line([(cx - size, cy), (cx + size, cy)], fill=color, width=max(2, size // 7))
    draw.line([(cx, cy - size), (cx, cy + size)], fill=color, width=max(2, size // 7))
    d = size * 0.45
    draw.line([(cx - d, cy - d), (cx + d, cy + d)], fill=color, width=max(1, size // 11))
    draw.line([(cx - d, cy + d), (cx + d, cy - d)], fill=color, width=max(1, size // 11))

def draw_cloud(draw, cx, cy, scale, color=CLOUD_COLOR):
    # ก้อนเมฆ = วงรีซ้อนกันหลายลูก นุ่มๆ กลมๆ
    puffs = [(-1.4, 0.1, 0.55), (-0.6, -0.25, 0.75), (0.3, -0.3, 0.85), (1.1, -0.05, 0.65), (1.7, 0.15, 0.5)]
    for dx, dy, s in puffs:
        r = 46 * scale * s
        px, py = cx + dx * 55 * scale, cy + dy * 55 * scale
        draw.ellipse([px - r, py - r * 0.8, px + r, py + r * 0.8], fill=color)

# ── ไอคอนลายเส้น (วาดเอง ไม่ใช้ emoji) — ทุกตัวรับ (draw, cx, cy, r, color, width) วาดกึ่งกลางจุด (cx,cy)
# กรอบสี่เหลี่ยมด้านขนาดประมาณ 2r x 2r
def icon_fish(draw, cx, cy, r, color, width):
    # ปลาลายเส้นล้วน (ไม่ลงสีทึบ) — ตัวปลารูปหยดน้ำมน + หางแฉก + ครีบบนเล็ก + ตา + ฟองอากาศ
    body_cx = cx - r * 0.12
    body_w, body_h = r * 1.35, r * 0.95
    bx0, by0, bx1, by1 = body_cx - body_w * 0.55, cy - body_h * 0.55, body_cx + body_w * 0.55, cy + body_h * 0.55
    draw.ellipse([bx0, by0, bx1, by1], outline=color, width=width)
    # หางแฉก
    tail_x = body_cx + body_w * 0.5
    draw.line([(tail_x, cy), (tail_x + r * 0.55, cy - r * 0.5), (tail_x + r * 0.15, cy), (tail_x + r * 0.55, cy + r * 0.5), (tail_x, cy)], fill=color, width=width, joint="curve")
    # ครีบบนเล็ก
    fin_x = body_cx + r * 0.05
    draw.line([(fin_x, cy - body_h * 0.5), (fin_x + r * 0.28, cy - body_h * 0.95), (fin_x + r * 0.4, cy - body_h * 0.42)], fill=color, width=width, joint="curve")
    # ตา (จุดทึบเล็กๆ เดียว ทั่วไปงานเส้นก็ยังใส่ตาทึบได้ อ่านง่ายกว่าวงกลมกลวง)
    eye_x, eye_y = body_cx - body_w * 0.28, cy - body_h * 0.12
    eye_r = r * 0.1
    draw.ellipse([eye_x - eye_r, eye_y - eye_r, eye_x + eye_r, eye_y + eye_r], fill=color)
    # ฟองอากาศเล็กๆ ข้างปาก
    bub_x, bub_y = body_cx - body_w * 0.62, cy + body_h * 0.05
    for i, br in enumerate([r * 0.07, r * 0.045]):
        draw.ellipse([bub_x - br - i * r * 0.2, bub_y - br - i * r * 0.12, bub_x + br - i * r * 0.2, bub_y + br - i * r * 0.12], outline=color, width=max(2, width - 3))

def icon_payi_mark(draw, cx, cy, r, color, width):
    # ร่างลายเส้นคร่าวๆ ของโลโก้ปลา/เลขแปด (∞) แบบที่ owner ส่งมาอ้างอิง — วงซ้ายใหญ่กว่า (หัวปลา มีตา)
    # วงขวาเล็กกว่า (หาง) + เครื่องหมาย + อยู่ด้านหลัง (มุมขวาบน, จางกว่า) ไม่วาดเต็มรายละเอียดเหมือนต้นฉบับ
    plus_cx, plus_cy, plus_s = cx + r * 0.75, cy - r * 0.7, r * 0.32
    draw.line([(plus_cx - plus_s, plus_cy), (plus_cx + plus_s, plus_cy)], fill=color, width=max(2, width - 2))
    draw.line([(plus_cx, plus_cy - plus_s), (plus_cx, plus_cy + plus_s)], fill=color, width=max(2, width - 2))
    left_r, right_r = r * 0.62, r * 0.42
    left_cx = cx - r * 0.35
    right_cx = cx + r * 0.45
    draw.ellipse([left_cx - left_r, cy - left_r * 0.8, left_cx + left_r, cy + left_r * 0.8], outline=color, width=width)
    draw.ellipse([right_cx - right_r, cy - right_r * 0.75, right_cx + right_r, cy + right_r * 0.75], outline=color, width=width)
    eye_x, eye_y = left_cx - left_r * 0.25, cy - left_r * 0.2
    draw.ellipse([eye_x - 4, eye_y - 4, eye_x + 4, eye_y + 4], fill=color)

def icon_box(draw, cx, cy, r, color, width):
    # กล่องของขวัญ 3 มิติ พิเศษ: หน้ากล่อง 3 ด้านลงสีทึบคนละเฉด (บนอ่อน/ซ้าย-ขวาเข้ม) + โบว์ริบบิ้นด้านบน
    # ไม่ใช้ค่า color ที่ส่งมาแล้ว (ไอคอนนี้มีชุดสีพิเศษของตัวเอง ต่างจากไอคอนเส้นเรียบตัวอื่น)
    top = cy - r * 0.85
    mid = cy - r * 0.15
    bot = cy + r * 0.75
    left, right = cx - r * 0.85, cx + r * 0.85
    center = (cx, mid + r * 0.15)
    top_pt, right_pt, bot_pt, left_pt = (cx, top), (right, mid - r * 0.2), (cx, bot), (left, mid - r * 0.2)
    right_face = [top_pt, right_pt, (right, bot - r * 0.2), bot_pt, center]
    left_face = [top_pt, left_pt, (left, bot - r * 0.2), bot_pt, center]
    top_face = [top_pt, right_pt, center, left_pt]
    draw.polygon(right_face, fill=(255, 152, 46))   # ส้มเข้ม (หน้าขวา เงา)
    draw.polygon(left_face, fill=(255, 183, 94))    # ส้มอ่อน (หน้าซ้าย รับแสง)
    draw.polygon(top_face, fill=(255, 208, 140))    # ส้มอ่อนสุด (ฝาบน)
    draw.line([top_pt, right_pt, (right, bot - r * 0.2), bot_pt, (left, bot - r * 0.2), left_pt, top_pt], fill=(180, 90, 10), width=max(2, width - 3), joint="curve")
    draw.line([top_pt, center], fill=(180, 90, 10), width=max(2, width - 3))
    draw.line([right_pt, center], fill=(180, 90, 10), width=max(2, width - 3))
    draw.line([left_pt, center], fill=(180, 90, 10), width=max(2, width - 3))
    draw.line([center, bot_pt], fill=(180, 90, 10), width=max(2, width - 3))
    # ริบบิ้นสีชมพูสดคาดกล่อง + โบว์ด้านบน
    rw = r * 0.16
    draw.line([(cx - rw, top), (cx - rw * 0.3, center[1])], fill=(233, 30, 99), width=int(rw * 2))
    draw.line([(cx + rw, top), (cx + rw * 0.3, center[1])], fill=(233, 30, 99), width=int(rw * 2))
    draw.line([(left, mid - r * 0.02), (right, mid - r * 0.02)], fill=(233, 30, 99), width=int(rw * 1.6))
    bow_y = top - r * 0.05
    draw.polygon([(cx, bow_y), (cx - r * 0.32, bow_y - r * 0.22), (cx - r * 0.1, bow_y)], fill=(240, 98, 146))
    draw.polygon([(cx, bow_y), (cx + r * 0.32, bow_y - r * 0.22), (cx + r * 0.1, bow_y)], fill=(240, 98, 146))
    draw.ellipse([cx - r * 0.1, bow_y - r * 0.1, cx + r * 0.1, bow_y + r * 0.1], fill=(216, 27, 96))

def icon_cart(draw, cx, cy, r, color, width):
    draw.line([(cx - r, cy - r * 0.6), (cx - r * 0.7, cy - r * 0.6), (cx - r * 0.35, cy + r * 0.35), (cx + r * 0.75, cy + r * 0.35), (cx + r, cy - r * 0.25), (cx - r * 0.55, cy - r * 0.25)], fill=color, width=width, joint="curve")
    draw.ellipse([cx - r * 0.35 - 9, cy + r * 0.55 - 9, cx - r * 0.35 + 9, cy + r * 0.55 + 9], outline=color, width=width)
    draw.ellipse([cx + r * 0.55 - 9, cy + r * 0.55 - 9, cx + r * 0.55 + 9, cy + r * 0.55 + 9], outline=color, width=width)

def icon_clipboard(draw, cx, cy, r, color, width):
    draw.rounded_rectangle([cx - r * 0.7, cy - r * 0.8, cx + r * 0.7, cy + r * 0.85], radius=r * 0.15, outline=color, width=width)
    draw.rounded_rectangle([cx - r * 0.28, cy - r * 0.98, cx + r * 0.28, cy - r * 0.72], radius=r * 0.1, outline=color, width=width)
    for i, dy in enumerate([-0.3, 0.05, 0.4]):
        draw.line([(cx - r * 0.4, cy + r * dy), (cx + r * 0.4, cy + r * dy)], fill=color, width=max(2, width - 2))

def icon_note_edit(draw, cx, cy, r, color, width):
    draw.rounded_rectangle([cx - r * 0.75, cy - r * 0.85, cx + r * 0.75, cy + r * 0.85], radius=r * 0.15, outline=color, width=width)
    for dy in [-0.35, -0.05, 0.25]:
        draw.line([(cx - r * 0.4, cy + r * dy), (cx + r * 0.2, cy + r * dy)], fill=color, width=max(2, width - 2))
    px0, py0, px1, py1 = cx + r * 0.15, cy + r * 0.35, cx + r * 0.75, cy + r * 0.95
    draw.line([(px0, py1), (px1, py0)], fill=color, width=width)
    draw.polygon([(px1 - 6, py0 - 6), (px1 + 6, py0 + 6), (px1 - 10, py0 + 14)], fill=color)

def icon_beach(draw, cx, cy, r, color, width):
    # ไอคอนดวงอาทิตย์ (แทนความหมายวันหยุด/ลา) — วงกลม + รัศมี 8 เส้นรอบทิศ อ่านง่ายกว่าร่มชายหาดที่วาดแล้วเบี้ยว
    import math
    draw.ellipse([cx - r * 0.5, cy - r * 0.5, cx + r * 0.5, cy + r * 0.5], outline=color, width=width)
    for deg in range(0, 360, 45):
        rad = math.radians(deg)
        x0, y0 = cx + math.cos(rad) * r * 0.65, cy + math.sin(rad) * r * 0.65
        x1, y1 = cx + math.cos(rad) * r * 0.95, cy + math.sin(rad) * r * 0.95
        draw.line([(x0, y0), (x1, y1)], fill=color, width=width)

def icon_globe(draw, cx, cy, r, color, width):
    draw.ellipse([cx - r * 0.85, cy - r * 0.85, cx + r * 0.85, cy + r * 0.85], outline=color, width=width)
    draw.ellipse([cx - r * 0.35, cy - r * 0.85, cx + r * 0.35, cy + r * 0.85], outline=color, width=max(2, width - 2))
    draw.line([(cx - r * 0.85, cy), (cx + r * 0.85, cy)], fill=color, width=max(2, width - 2))

def icon_question(draw, cx, cy, r, color, width):
    draw.ellipse([cx - r * 0.85, cy - r * 0.85, cx + r * 0.85, cy + r * 0.85], outline=color, width=width)
    f = font("Bold", int(r * 1.15))
    bbox = draw.textbbox((0, 0), "?", font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text((cx - tw // 2, cy - th // 2 - bbox[1]), "?", font=f, fill=color)

def icon_book(draw, cx, cy, r, color, width):
    # หนังสือเปิด: สี่เหลี่ยม 2 ฝั่งเอียงออกจากสันกลาง (เส้นตรงล้วน กันโค้ง arc เพี้ยนแบบที่แล้ว)
    spine_top, spine_bot = cy - r * 0.75, cy + r * 0.8
    draw.line([(cx, spine_top), (cx, spine_bot)], fill=color, width=width)
    left_pts = [(cx, spine_top), (cx - r * 0.95, spine_top + r * 0.12), (cx - r * 0.95, spine_bot + r * 0.12), (cx, spine_bot)]
    right_pts = [(cx, spine_top), (cx + r * 0.95, spine_top + r * 0.12), (cx + r * 0.95, spine_bot + r * 0.12), (cx, spine_bot)]
    draw.line(left_pts, fill=color, width=width, joint="curve")
    draw.line(right_pts, fill=color, width=width, joint="curve")
    for dy in [0.15, 0.4]:
        draw.line([(cx - r * 0.65, cy + r * dy), (cx - r * 0.15, cy + r * dy)], fill=color, width=max(2, width - 3))
        draw.line([(cx + r * 0.15, cy + r * dy), (cx + r * 0.65, cy + r * dy)], fill=color, width=max(2, width - 3))

def icon_chart(draw, cx, cy, r, color, width):
    bars = [(-0.55, 0.15, (236, 64, 122)), (0.0, -0.35, (30, 136, 229)), (0.55, -0.7, (67, 160, 71))]
    for bx, top, bar_color in bars:
        draw.rounded_rectangle([cx + r * bx - r * 0.22, cy + r * top, cx + r * bx + r * 0.22, cy + r * 0.85], radius=r * 0.08, outline=bar_color, width=width)

ICONS = {
    "box": icon_box, "fish": icon_fish, "cart": icon_cart, "clipboard": icon_clipboard, "note_edit": icon_note_edit,
    "beach": icon_beach, "globe": icon_globe, "question": icon_question, "book": icon_book, "chart": icon_chart,
}

def icon_center(draw, cx, cy, icon_name, r, color, width=7):
    ICONS[icon_name](draw, cx, cy, r, color, width)

def draw_hero_card(base, draw, box, icon, label, subtitle, gap):
    # การ์ดหลักสไตล์ hero (ไล่สีม่วง-ชมพู + ไอคอนใหญ่ + ปุ่มขาว + เมฆถ้าสูงพอ) — เรียกซ้ำได้หลายใบต่อภาพ
    # (เดิมมีแค่ 1 ใบต่อภาพ owner ขอให้ทำ 2 ใบเท่ากันแทนปุ่ม pill เล็กๆ ด้านข้าง)
    hx0, hy0, hx1, hy1 = box[0] + gap, box[1] + gap, box[2] - gap, box[3] - gap
    paste_gradient_box(base, (hx0, hy0, hx1, hy1), HERO_START, HERO_END, 32, shadow=True, draw_ctx=draw)

    cloud_layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    cloud_draw = ImageDraw.Draw(cloud_layer)
    hcx = (hx0 + hx1) // 2
    if (hy1 - hy0) >= 400:
        scale = (hx1 - hx0) / 900
        cloud_y = hy1 - 34 * scale
        draw_cloud(cloud_draw, hcx - (hx1 - hx0) * 0.22, cloud_y, scale)
        draw_cloud(cloud_draw, hcx + (hx1 - hx0) * 0.28, cloud_y + 6 * scale, scale * 0.85)
    card_mask = Image.new("L", base.size, 0)
    ImageDraw.Draw(card_mask).rounded_rectangle([hx0, hy0, hx1, hy1], radius=32, fill=255)
    cloud_layer.putalpha(Image.composite(cloud_layer.split()[3], Image.new("L", base.size, 0), card_mask))
    base.alpha_composite(cloud_layer)
    draw = ImageDraw.Draw(base)

    hero_icon_r = min((hy1 - hy0) * 0.20, (hx1 - hx0) * 0.16)
    hero_icon_cy = hy0 + (hy1 - hy0) * 0.30
    hero_icon_w = max(5, int(hero_icon_r * 0.09))
    icon_center(draw, hcx, hero_icon_cy, icon, hero_icon_r, WHITE, hero_icon_w)
    pill_w, pill_h = min(int((hx1 - hx0) * 0.8), 420), 74
    pill_box = (hcx - pill_w // 2, hy0 + (hy1 - hy0) // 2 + 6, hcx + pill_w // 2, hy0 + (hy1 - hy0) // 2 + 6 + pill_h)
    draw.rounded_rectangle(pill_box, radius=pill_h // 2, fill=WHITE)
    hero_label_font = fit_font(draw, label, "Bold", 40, pill_w - 40)
    text_center(draw, hcx, pill_box[1] + (pill_h - 40) // 2, label, hero_label_font, HERO_TEXT)
    if subtitle:
        sub_font = fit_font(draw, subtitle, "Bold", 24, (hx1 - hx0) - 40)
        text_center(draw, hcx + 1, pill_box[3] + 17, subtitle, sub_font, (60, 20, 90, 160))
        text_center(draw, hcx, pill_box[3] + 16, subtitle, sub_font, WHITE)

def draw_hero_layout(filename, width, height, heroes, side_pills, bottom_cards, hero_boxes, pill_boxes, card_boxes):
    base = diagonal_gradient((width, height), BG_TOP, BG_BOTTOM).convert("RGBA")
    draw = ImageDraw.Draw(base)
    gap = 14

    # ประกายดาวกระจายทั่วพื้นหลัง (มุม/ขอบ เลี่ยงทับตัวการ์ด)
    for sx, sy, ssize in [(28, 26, 13), (width - 34, 22, 11), (width - 24, height - 30, 15),
                          (18, height - 24, 10), (width // 2, 14, 9)]:
        draw_sparkle(draw, sx, sy, ssize)

    # ── Hero card(s) — 1 ใบ (เดิม) หรือหลายใบเท่ากัน (owner ขอ 2026-08-06: 2 ปุ่ม pill เดิมกลายเป็นการ์ดหลัก) ──
    for hero, box in zip(heroes, hero_boxes):
        draw_hero_card(base, draw, box, hero["icon"], hero["label"], hero.get("subtitle"), gap)

    # ── Side pills ──
    for pill, box in zip(side_pills, pill_boxes):
        x0, y0, x1, y1 = box
        inner = (x0 + gap, y0 + gap, x1 - gap, y1 - gap)
        paste_gradient_box(base, inner, PILL_START, PILL_END, 30, shadow=True, draw_ctx=draw)
        cx, cy = (inner[0] + inner[2]) // 2, (inner[1] + inner[3]) // 2
        draw_sparkle(draw, inner[0] + 26, inner[1] + 24, 8)
        f = fit_font(draw, pill["label"], "Bold", 36, (inner[2] - inner[0]) - 40)
        text_center(draw, cx, cy - 22, pill["label"], f, WHITE)

    # ── Bottom cards — ทำเป็นกระจกใสฟองอากาศ (glassmorphism): พื้นขาวโปร่งแสง + highlight เงาสะท้อนนุ่มๆ ──
    for card, box in zip(bottom_cards, card_boxes):
        x0, y0, x1, y1 = box
        inner = (x0 + gap, y0 + gap, x1 - gap, y1 - gap)
        ix0, iy0, ix1, iy1 = inner
        off = 6
        draw.rounded_rectangle([ix0 + off, iy0 + off, ix1 + off, iy1 + off], radius=26, fill=SHADOW_COLOR)

        glass = Image.new("RGBA", (ix1 - ix0, iy1 - iy0), (0, 0, 0, 0))
        gdraw = ImageDraw.Draw(glass)
        gdraw.rounded_rectangle([0, 0, ix1 - ix0 - 1, iy1 - iy0 - 1], radius=26, fill=GLASS_FILL)
        # highlight เงาสะท้อนวงรีมุมบนซ้าย ให้ความรู้สึกผิวมันวาวแบบฟองสบู่
        hl_w, hl_h = (ix1 - ix0) * 0.85, (iy1 - iy0) * 0.5
        gdraw.ellipse([-hl_w * 0.25, -hl_h * 0.55, hl_w * 0.75, hl_h * 0.45], fill=GLASS_HIGHLIGHT)
        mask = Image.new("L", (ix1 - ix0, iy1 - iy0), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, ix1 - ix0 - 1, iy1 - iy0 - 1], radius=26, fill=255)
        glass.putalpha(Image.composite(glass.split()[3], Image.new("L", glass.size, 0), mask))
        base.alpha_composite(glass, (ix0, iy0))
        draw.rounded_rectangle(inner, radius=26, outline=CARD_BORDER, width=3)
        draw_sparkle(draw, ix1 - 22, iy0 + 20, 9)

        cx = (ix0 + ix1) // 2
        icon_center(draw, cx, iy0 + (iy1 - iy0) // 2 - 40, card["icon"], 30, ICON_COLORS.get(card["icon"], ICON_COLOR), 6)
        label = card["label"]
        f = fit_font(draw, label, "Bold", 36, (ix1 - ix0) - 24)
        text_center(draw, cx, iy0 + (iy1 - iy0) // 2 + 26, label, f, LABEL_COLOR)

    base.convert("RGB").save(os.path.join(OUT_DIR, filename), "PNG")
    print(filename, base.size)

# ── Full tier (Boss/Dev) — 1200x810 — owner ขอ 2026-08-06: ไม่เอาการ์ด "แจ้งของเข้า" เป็น hero แล้ว เอา
# 2 ปุ่ม pill เดิม (สั่งของ/ของเข้ารอตรวจ) มาเป็นการ์ดหลักแทน — แจ้งของเข้าลงไปเป็นการ์ดล่างธรรมดาแทน
draw_hero_layout(
    "richmenu-full.png", 1200, 810,
    heroes=[
        {"icon": "cart", "label": "สั่งของ", "subtitle": "แตะเพื่อสั่งของเข้าคลัง"},
        {"icon": "clipboard", "label": "ของเข้ารอตรวจ", "subtitle": "แตะเพื่อดูรายการรอ Approve"},
    ],
    side_pills=[],
    bottom_cards=[
        {"icon": "note_edit", "label": "อนุมัติการลา"},
        {"icon": "book", "label": "เช็คประวัติ"},
        {"icon": "box", "label": "รายการที่สั่งไว้"},
        {"icon": "globe", "label": "เว็บแอพ"},
        {"icon": "question", "label": "ช่วยเหลือ"},
    ],
    hero_boxes=[(0, 0, 600, 400), (600, 0, 1200, 400)],
    pill_boxes=[],
    card_boxes=[(0, 400, 240, 810), (240, 400, 480, 810), (480, 400, 720, 810), (720, 400, 960, 810), (960, 400, 1200, 810)],
)

# ── Stock tier (ฟ้า/แตง) — 1200x810 (ขยายจาก 800x540 เดิม ใส่ เช็คประวัติ/เช็ควันลาคงเหลือ เพิ่มตามที่ขอ) ──
draw_hero_layout(
    "richmenu-stock.png", 1200, 810,
    heroes=[{"icon": "fish", "label": "แจ้งของเข้า", "subtitle": "แตะเพื่อเริ่มบันทึกของเข้า"}],
    side_pills=[{"label": "ขอลา"}, {"label": "เว็บแอพ"}],
    bottom_cards=[
        {"icon": "book", "label": "เช็คประวัติ"},
        {"icon": "chart", "label": "เช็ควันลาคงเหลือ"},
        {"icon": "question", "label": "ช่วยเหลือ"},
    ],
    hero_boxes=[(0, 0, 800, 540)],
    pill_boxes=[(800, 0, 1200, 270), (800, 270, 1200, 540)],
    card_boxes=[(0, 540, 400, 810), (400, 540, 800, 810), (800, 540, 1200, 810)],
)

# ── Staff tier — 800x540 ──
draw_hero_layout(
    "richmenu-staff.png", 800, 540,
    heroes=[{"icon": "beach", "label": "ขอลา", "subtitle": "แตะเพื่อเริ่มขอลา"}],
    side_pills=[],
    bottom_cards=[
        {"icon": "book", "label": "เช็คประวัติ"},
        {"icon": "chart", "label": "เช็ควันลาคงเหลือ"},
        {"icon": "question", "label": "ช่วยเหลือ"},
    ],
    hero_boxes=[(0, 0, 800, 300)],
    pill_boxes=[],
    card_boxes=[(0, 300, 267, 540), (267, 300, 534, 540), (534, 300, 800, 540)],
)
