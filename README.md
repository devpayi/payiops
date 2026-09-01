# PAYI Ops — Retail Control Room

ระบบจัดการธุรกิจ e-commerce (Shopee / TikTok Shop / Lazada) — React + Vite + Recharts บนหน้าเว็บ, Vercel Serverless Functions + Google Sheets เป็น backend ใช้ **free tier ทั้งหมด**

> รายละเอียดฉบับเต็ม (schema, gotcha, roadmap ที่ตกลงกับเจ้าของร้าน) อยู่ใน `CLAUDE.md` — README นี้ตั้งใจให้สั้น แค่พอรัน/deploy ได้

## โครงสร้าง (ย่อ)

```
mona-ops/
├── src/
│   ├── App.jsx              # โครงแอปหลัก (sidebar/bottom-tabbar + tab, ไม่ใช้ router)
│   ├── theme.css            # ธีม PAYI (CSS variables)
│   ├── components/KpiCard.jsx
│   └── pages/                # ดูรายชื่อหน้าทั้งหมดใน CLAUDE.md § Files
├── api/                       # Vercel Serverless Functions (9/12, 3 slot ว่าง)
│   ├── dashboard.js / monthly.js / products.js / product-trends.js
│   ├── import-orders.js      # นำเข้าออเดอร์ + จับคู่ SKU + กันซ้ำ + แยก tab รายเดือน
│   ├── planner-sales.js      # ABC classification + ยอดขายเฉลี่ย
│   ├── marketing.js          # ?kind=events|inputs|basket
│   ├── sheet-tools.js        # ?op=... — HR, workforce, planner, inventory, cfo, demographic, LINE webhook ฯลฯ
│   ├── auth.js
│   └── _lib/                 # sheets.js, productGroup.js, inventory.js, cfo.js, demographic.js, skuMapping.js, ฯลฯ
├── shared/roles.js           # role constants (dev/boss/staff/stock/marketing/finance)
├── test/                     # node:test unit tests
├── recovered/                 # ไฟล์ต้นฉบับที่กู้มาจาก claude.ai (สำรองไว้)
└── vercel.json
```

## รันในเครื่อง

```bash
npm install
npm run dev        # http://localhost:5173 — เสิร์ฟทั้งหน้าเว็บและ /api/*
npm run build       # เช็ค compile
npm test            # node:test
```

> ต้องมีไฟล์ `.env` ที่ root — `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SHEET_ID`
> `vite.config.js` มี middleware จำลอง Vercel functions ให้ `/api/*` ทำงานตอน dev
> local dev ไม่มี `AUTH_SECRET` = auth ปิด (ทุกคนเข้าได้หมด) — ตั้งใจสำหรับ dev เท่านั้น

## Deploy แบบฟรีทั้งหมด

### 1. Push ขึ้น GitHub

```bash
git remote add origin https://github.com/monalll13/mona-ops.git
git branch -M main
git push -u origin main
```

⚠️ `.gitignore` กัน `.env` ไว้แล้ว — private key ไม่หลุดขึ้น GitHub

### 2. Deploy บน Vercel

1. สมัคร [vercel.com](https://vercel.com) ด้วยบัญชี GitHub (ฟรี ไม่ต้องใส่บัตร)
2. **Add New → Project** → เลือก repo `mona-ops` (Vercel ตรวจเจอ Vite อัตโนมัติ)
3. ตั้ง **Environment Variables** 4 ตัว (3 ตัวแรกค่าเดียวกับใน `.env`):

   | ชื่อ | ค่า |
   |---|---|
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | อีเมล service account |
   | `GOOGLE_PRIVATE_KEY` | private key ทั้งก้อน (รวม `\n`) |
   | `SHEET_ID` | Sheet ID ของ "mona-ops-db" |
   | `AUTH_SECRET` | **ข้อความสุ่มยาวๆ เดายาก** สำหรับระบบ login (สำคัญมาก ไม่ตั้ง = ใครก็อ่าน/ลบข้อมูลได้) |

4. กด **Deploy** → ได้ URL `.vercel.app` — push ครั้งต่อไป deploy อัตโนมัติ
5. เปิดเว็บครั้งแรก → ระบบให้**สร้างบัญชี admin คนแรก** (ชื่อผู้ใช้+รหัสผ่าน) แล้ว login ให้เลย
   คนอื่นในทีมให้ admin สั่งเพิ่มผ่าน `POST /api/auth` action `create-user` (หรือให้ Claude เพิ่มให้)

**สถานะ deploy จริง (push ขึ้น GitHub แล้วหรือยัง, ตั้ง env บน Vercel ครบหรือยัง) เปลี่ยนได้เรื่อยๆ — เช็คกับเจ้าของร้านตรงๆ แทนที่จะเชื่อ README**

## ข้อมูลจริง

ออเดอร์ ~190,000+ แถวใน `raw_orders_2026_MM`, 3 ธุรกิจ (Payi / Payi Outlet / กรอบรูป)
`/api/dashboard`, `/api/monthly`, `/api/products` aggregate ฝั่ง server แล้ว cache — เลี่ยงชน rate limit ของ Sheets

## หมายเหตุ

- ระบบ **Claims ถูกย้ายออกไปทั้งหมดแล้ว** (ไปอยู่ที่ payi-floor) — ไม่มี claims ในแอปนี้อีก
- โครงสร้าง/roadmap/gotcha ละเอียดทั้งหมดอยู่ใน `CLAUDE.md` ที่ root — อ่านไฟล์นั้นก่อนแก้โค้ดเสมอ
