# scripts/turso-trial

สคริปต์ทดลองย้ายออเดอร์ไป Turso (ตุลาคม 2026) และเครื่องมือดูแลสำเนา รายละเอียดแผนอยู่ที่ `docs/orders-turso-mirror.th.md`

รันจากรากโปรเจกต์เสมอ: `node --use-system-ca --env-file=.env scripts/turso-trial/<ไฟล์>`
ต้องมี `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` ใน `.env` (ไม่เข้า git) — snapshot และไฟล์ `.sqlite` มีออเดอร์จริง ถูกกันไว้ใน `.gitignore` แล้ว

## เครื่องมือดูแล (ใช้จริง)
- `backfill.mjs` — เทียบ/โหลดสำเนา `raw_orders` ใน Turso จาก Sheets รันซ้ำได้ (แท็บที่ตรงแล้วไม่เขียนใหม่) `--dry` = เทียบอย่างเดียว
- `rehearse-copy.mjs` — ซ้อมทั้งวงจรบน **ชีตสำเนา** (นำเข้า → นำเข้าซ้ำ → แก้สถานะ → ลบล็อต → จำลอง Turso ล่ม → reconcile ซ่อม) รัน handler จริงในเครื่อง เขียนเฉพาะสำเนา + ตาราง Turso `raw_orders_rehearsal` มี guard กันชี้ชีตจริง: `REHEARSAL_SHEET_ID=<id สำเนา> node --use-system-ca --env-file=.env scripts/turso-trial/rehearse-copy.mjs` (ต้องแชร์สำเนาให้ service account แบบ Editor และชื่อไฟล์มี copy/สำเนา/rehearsal/test) ทิ้งตารางซ้อมได้ทีหลัง: `DROP TABLE raw_orders_rehearsal`
- `restore-drill.mjs` — ซ้อมสำรอง→กู้คืนลงไฟล์ libSQL ในเครื่อง แล้วเทียบ fingerprint ต่อแท็บ

## สคริปต์ทดลอง (ตามลำดับที่ใช้)
1. `01-export-snapshot.mjs <โฟลเดอร์>` — ดึงทุกแท็บ `raw_orders_*` เป็น JSON (อ่านชีตอย่างเดียว)
2. `02-build-sqlite.mjs <snap> <out.sqlite> [lean]` — สร้างฐาน SQLite (`node:sqlite`) จาก snapshot
3. `03-compare-*.mjs <sqlite>` — เทียบผลของ `/api/monthly`, `/api/products`, `/api/dashboard` กับ SQL (ต่าง 0 ทุกค่าที่ทดสอบ)
4. `04-trial-load-turso.mjs` / `05-bench-turso.mjs` — โหลดตารางทดลอง `orders` + จับเวลา query ผ่านเครือข่าย (ตารางทดลองนี้ **ไม่ใช่** ตาราง `raw_orders` ของสำเนาจริง ลบทิ้งได้)
5. `06-manual-edit-check.mjs <snap>` — ตรวจแถวที่ไม่มีที่มาใน `import_log`
6. `07-sqlite-index-timing.mjs` — ลอง index ครอบคลุม/คอลัมน์ `ex` ใน SQLite

หมายเหตุ: สคริปต์ 02–07 เขียนตอนทดลอง ยึดชื่อตาราง/คอลัมน์ของฐานทดลอง ไม่ใช่ schema ของ `api/_lib/ordersMirror.js`
