# สำเนา raw_orders ใน Turso (ระยะ 0: เขียนคู่ — ยังไม่มี endpoint ไหนอ่านจาก Turso)

อัปเดต: 23 ต.ค. 2026

## หลักการ
- **Google Sheets เป็นแหล่งหลักเสมอ** Turso เป็นสำเนาที่ตามหลัง ทำตามผลที่ Sheets เขียนจริง (แถวที่ Sheets ข้าม เช่นออเดอร์กำกวม ไม่ถูกส่งไป Turso)
- **ปิดอยู่เป็นค่าเริ่มต้น** เปิดด้วย env `TURSO_MIRROR=on` + `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (ตั้งใน Vercel เอง ห้ามเข้า git)
- **Turso พัง/ช้าต้องไม่ทำให้นำเข้าล้ม** `mirrorRows`/`mirrorDeleteLot` ไม่ throw มี timeout 8 วินาที ถ้าไม่สำเร็จจะบันทึกธง `dirty` ลงแท็บ `turso_dirty` ในชีต (append-only, ถาวร) แล้ว `reconcile` ซ่อมทั้งเดือนจาก Sheets
- ตาราง `raw_orders` ใน Turso: 22 คอลัมน์ A–V + `src_tab`/`ym`/`ex` **ไม่บังคับ unique บน order_key** เพราะข้อมูลเดือน ม.ค.–พ.ค. 2026 มี key ซ้ำเป็นพันชุด (คนละสินค้าใช้ key เดียวกัน) dashboard เดิมนับตามแถว สำเนาต้องมีจำนวนแถวเท่าชีตเป๊ะ

## โค้ด
| ไฟล์ | หน้าที่ |
|---|---|
| `api/_lib/ordersMirror.js` | สำเนา/ธง dirty/ซ่อมเดือน/ตรวจ (`mirrorRows`, `mirrorDeleteLot`, `resyncTab`, `reconcile`, `mirrorStatus`) |
| `api/import-orders.js` | POST: ส่งแถวที่ Sheets เขียนจริง (newRows + updates) · DELETE: ลบล็อตตาม `import_id` แล้วเทียบจำนวนกับที่ชีตลบ |
| `api/_lib/ingestOrders.js` | ทางเดียวกันสำหรับ TikTok API sync (`api/tiktok.js`) |
| `api/sheet-tools.js` | `op=append`/`op=overwrite` **ปฏิเสธชื่อแท็บ `raw_orders*`** (403) · `op=orders-mirror` (dev เท่านั้น) · `cron=orders-mirror` |
| `test/ordersMirror.test.js` | 12 เทสต์ ใช้ libSQL ในหน่วยความจำ + ชีตจำลอง (ไม่แตะ Google/Turso จริง) |
| `scripts/turso-trial/` | สคริปต์ทดลอง + `backfill.mjs` + `restore-drill.mjs` (ดู README ในโฟลเดอร์) |

## คำสั่งดูแล
```
# สถานะ + เทียบ (dev login)
GET  /api/sheet-tools?op=orders-mirror
GET  /api/sheet-tools?op=orders-mirror&action=reconcile            # เทียบ 2 เดือนล่าสุด + แท็บติดธง และซ่อมถ้าไม่ตรง
GET  /api/sheet-tools?op=orders-mirror&action=reconcile&repair=0   # ดูเฉยๆ ไม่เขียน
POST /api/sheet-tools?op=orders-mirror&action=resync&tab=raw_orders_2026_09
```
Backfill/ตรวจทั้งปีจากเครื่อง: `node --use-system-ca --env-file=.env scripts/turso-trial/backfill.mjs [--dry]`

## Cron รายวัน (เพิ่มใน `vercel.json` แล้ว — 20:00 UTC = 03:00 เวลาไทย)
`/api/sheet-tools?op=orders-mirror&cron=orders-mirror` ต้องมี `CRON_SECRET` (ปฏิเสธถ้าไม่มี) และ `TURSO_MIRROR=on` — ถ้าปิดกระจกอยู่จะตอบ `enabled:false` เฉยๆ
เทียบ 2 เดือนล่าสุดที่ไม่เกินเดือนปัจจุบัน + **เดือนเก่าหมุนวันละ 1 เดือน** (ครบทุกเดือนเป็นรอบ) + แท็บที่ติดธง แล้วซ่อมเฉพาะที่ไม่ตรง **ถ้ายังมีแท็บไม่ตรง/ซ่อมไม่ครบ/ติดธงค้าง จะตอบ HTTP 500** → Vercel แสดงว่า cron ล้มเหลว (หน้า Settings → Cron Jobs / Logs) เป็นตัวเตือนเดียวตอนนี้ (ยังไม่ส่ง LINE)
fingerprint = จำนวนแถว, ยอด(สตางค์), ชิ้น, hash ของ (key, สถานะ, ยอด, qty, SKU, import_id) — **จับการแก้ด้วยมือในชีตได้ ถ้าแก้คอลัมน์เหล่านี้** แต่ถ้าแก้เฉพาะชื่อสินค้า/จังหวัดจะไม่เห็น

## ข้อควรระวัง / ที่ยังไม่ครอบคลุม
- **โควตาเขียนฟรีของ Turso = 10 ล้านแถว/เดือน (ดัชนีนับด้วย)** ราว 6 แถวเขียนต่อ 1 ออเดอร์ที่ซ่อม อย่าสั่งซ่อมทั้งปีซ้ำๆ — reconcile ซ่อมเฉพาะแท็บที่ไม่ตรง และถ้าตรงแต่ติดธงจะแค่ปลดธง
- **ซ่อมเดือน = ลบแล้วใส่ใหม่** ระหว่างซ่อมเดือนนั้นในสำเนาไม่ครบ ไม่เป็นไรในระยะ 0 (ยังไม่มีใครอ่านจาก Turso) แต่ก่อนสลับฝั่งอ่านต้องเปลี่ยนเป็นสลับทีละชุด (generation) หรือให้ fallback ไป Sheets เมื่อเดือนนั้นติดธง
- การซ่อมในฟังก์ชันมีงบเวลา ~45–50 วินาที (เพดาน Vercel 60 วินาที) เดือนที่ใหญ่มากจากไกลอาจไม่ทัน → ติดธงต่อ รันซ้ำ หรือใช้ `backfill.mjs` จากเครื่อง
- **ทางเขียนที่ดักไม่ได้:** แก้ในชีตด้วยมือ, `scripts/delete-import-batch.mjs`, สคริปต์ one-off อื่น — ต้องพึ่ง `reconcile` (หลังใช้สคริปต์พวกนี้ให้สั่ง `resync` เดือนนั้น)
- สอง import พร้อมกัน (เช่น TikTok cron + อัปโหลดมือ) race กันเองใน Sheets อยู่แล้ว สำเนาจึงอาจเพี้ยนตามได้ — `reconcile` แก้ให้
- ข้อมูลเก่า (ม.ค.–พ.ค.) key ซ้ำ: ถ้านำเข้าเดือนเหล่านั้นซ้ำ สำเนาจะติดธง `duplicate-key` แล้วซ่อมทั้งเดือนให้เท่าชีต

## เวลา/เบรกเกอร์ (กัน Turso ค้างทำให้นำเข้าเกิน 60 วินาที)
- `mirrorRows` มีงบเวลารวม 12 วินาทีต่อครั้ง ทุกคำสั่งรอได้ไม่เกินเวลาที่เหลือในงบ งบหมด = หยุด ติดธง ไม่วนรอทุก chunk
- เบรกเกอร์ 60 วินาที **อยู่ในหน่วยความจำของ instance นั้น** (Vercel instance อื่นไม่รู้) การป้องกันหลักจึงคืองบเวลาต่อ request ส่วนเบรกเกอร์แค่ลดการรอซ้ำใน instance เดียวกัน
- timeout แค่ "เลิกรอ" — คำสั่งที่ส่งไปแล้วอาจยังไปจบที่ Turso ทีหลัง (ยกเลิกไม่ได้) แต่เป็นแบบ ลบตาม key แล้วใส่ใหม่ในธุรกรรมเดียว จึงไม่เบิ้ล เสี่ยงแค่เขียนค่าเก่าทับค่าใหม่ ซึ่ง `reconcile` จะจับ
- เวลาของ markDirty (เขียนชีต) ไม่นับในงบ 12 วินาที

## ย้อนกลับ
ระยะ 0 ไม่มี endpoint ใดอ่านจาก Turso — ปิดกระจกด้วยการเอา `TURSO_MIRROR=on` ออก (หรือตั้งเป็นอย่างอื่น) ทุกอย่างกลับเป็นแบบเดิมทันที ไม่ต้อง deploy โค้ดใหม่ ฐาน Turso ลบทิ้งได้โดยไม่กระทบอะไร
ระยะ 2 (สลับฝั่งอ่าน): ตั้งใจให้เป็น env ต่อ endpoint + fallback ไป Sheets อัตโนมัติเมื่อ Turso error

## รายการผู้ใช้ข้อมูล `raw_orders` (ตรวจ 23 ต.ค. 2026 จากการค้นโค้ด — ก่อนสลับฝั่งอ่านต้องไล่ทีละตัว)
**เขียน:** `api/import-orders.js` (POST/DELETE) · `api/_lib/ingestOrders.js` ← `api/tiktok.js` (cron/ดึงด้วยมือ) · `scripts/delete-import-batch.mjs` · ทางลัดที่ปิดแล้ว: `sheet-tools op=append/overwrite`
**อ่าน (API ในโปรเจกต์นี้):** `dashboard.js` (+`?view=daily`) · `monthly.js` · `products.js` · `product-trends.js` · `planner-sales.js` · `sheet-tools.js` (`op=summary`) · `_lib/cfo.js` · `_lib/demographic.js` · `_lib/fulfillment.js` · `_lib/marketingBasket.js` · `_lib/marketingEvents.js` · `_lib/packagingOrderRules.js` · `_lib/pricingData.js` · `_lib/workspace.js`
**อ่านจากภายนอก (ยังไม่ได้ตรวจโค้ด):** เว็บ Marketing ของตูน (อ่าน `raw_orders_*` ตรง) · payi-floor (ใช้ `sheets.js` ชุดเดียวกัน อ่านผ่าน Sheets) — จนกว่าจะเลิกเขียน Sheets (ระยะ 3) สองที่นี้ยังอ่านชีตได้เหมือนเดิม ไม่ต้องแก้
**สคริปต์อ่านเท่านั้น:** `scripts/archive-orders-verify.mjs`, `audit-duplicate-orders.mjs`, `check-color-mismatch.mjs`

## ผลตรวจก่อนทำ (23 ต.ค. 2026)
- 9 เดือน 336,441 แถว: ทุกแถวมี `import_id` ที่มีใน `import_log` ไม่มีแถวของล็อตที่ถูกลบ → ไม่พบแถวที่ถูกพิมพ์เพิ่มเองนอกระบบนำเข้า (การแก้ค่าในเซลล์เดิมตรวจไม่ได้จากข้อมูลนี้)
- key ซ้ำ: ม.ค. 1,569 ชุด · ก.พ. 1,264 · มี.ค. 1,292 · เม.ย. 946 · พ.ค. 709 · มิ.ย.–ก.ย. 0
