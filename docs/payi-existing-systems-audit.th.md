# PAYI: โครงสร้างที่มีจริงจากโค้ด

ตรวจ 22 กันยายน 2026 แบบอ่านไฟล์ ไม่เรียก API จริง ไม่แก้แอปหรือข้อมูล และไม่ได้ตรวจจำนวน Functions จาก deployment จริง

## 1. PAYI Ops

ที่อยู่: C:/Users/PC/Desktop/MONA/New/mona-ops

- React/Vite; API แบบ api/*.js; แหล่งข้อมูลหลักของเว็บเดิมคือ Google Sheets
- เมนูใน src/App.jsx: Dashboard ยอดขาย/สินค้า, Import Orders, Marketing Radar, Ads & Channels, Content OS Prototype, Inventory, Stock Movement, Import Tracking, WHT Cert, HR, HR People, CFO, Fulfillment, SOPs, Links Hub, Dev Hub, Settings (เมนู Demographic ถอดออกแล้ว 2026-09-30 — ดู CLAUDE.md)
- มีบัญชีรายคนในชีต users ผ่าน api/auth.js; ปัจจุบันผู้ใช้มีฟิลด์ role เดียว
- shared/roles.js: dev, boss, staff, stock, marketing, finance, tang
- API รับ token ผ่าน x-api-token; ยังไม่ใช่ระบบบัญชีร่วมกับอีกสองแอป
- พบไฟล์ entry point api/*.js จำนวน 10 ไฟล์ ไม่รวม helper
- มี backend/core แยกใน repository เดียวกัน เอกสารระบุว่ายังไม่ได้ย้าย Sheets เข้า PostgreSQL ไม่ถือว่า Core คือ backend ที่ทั้งสามแอปใช้งานร่วมกันแล้ว

## 2. PAYI Floor

ที่อยู่: C:/Users/PC/Desktop/MONA/New/payi-floor

- React/Vite; API แบบ api/*.js; Google Sheets ผ่าน api/_lib/sheets.js
- src/App.jsx มีภาพรวม, เคลม, Planner Control (แพลนฟีด/สินค้าที่ต้องฟีด), Manpower และ OT, บันทึกเหตุการณ์, SOP, เป้าหมาย และคนบ้านล่าง
- พบไฟล์ entry point API จำนวน 12 ไฟล์: auth, checklist, planner-sales, overview, goals, planner, claims, events, claims-import, floor-people, feed-summary, workforce
- api/_lib/auth.js ใช้รหัสผ่านร่วมทั้งเว็บ ไม่มีบัญชีรายคน token มีเวลาหมดอายุและรับผ่าน Authorization: Bearer
- งานคน/OT อ้างชื่อชีต workforce_*, hr_leave; งานเคลมอ้าง claims, product_aliases, inventory_items; Planner อ้าง planner_config/planner_daily
- ยังไม่ยืนยันว่า SHEET_ID ของ Floor กับ Ops เป็นไฟล์เดียวกัน เพราะไม่ได้ตรวจค่าตั้งจริง
- จากรายการหน้าและ API ที่อ่าน ยังไม่ควรเรียก Floor ว่าระบบแพ็ค/ขนส่งครบวงจร ต้องแยกข้อเสนออนาคตออกจากสิ่งที่มีจริง

## 3. PAYI Management / Live

ที่อยู่: C:/Users/PC/Desktop/payi-webapp

- Next.js 16.2.9 / React 19.2.4 / TypeScript ตาม package.json
- lib/db.ts ใช้ libSQL: เชื่อม Turso เมื่อมีค่าตั้ง หรือ SQLite ในเครื่องเมื่อไม่มี ยังไม่ได้ยืนยันค่าที่ production ใช้
- เมนูผู้จัดการใน components/AdminSidebar.tsx: กรอกยอดรายเดือน, สรุปภาพรวม, รายงาน, ตารางงาน, คิดค่าจ้าง, เป้าหมาย, คนไลฟ์, ตั้งค่า
- มีฟอร์มคนไลฟ์; app/api/streamer-sessions/route.ts อนุญาตส่งฟอร์มโดยไม่ล็อกอินเมื่อผู้จัดการเปิดลิงก์ ส่วนการดึงรายการทั้งหมดต้องมี session
- lib/auth.ts ตรวจบัญชีผู้จัดการจาก environment และออก JWT ใน HttpOnly cookie ชื่อ payi_session
- ข้อมูลหลัก: manager_entries, streamer_sessions, monthly_goals, roster_people, reconcile_approvals, work_shifts, campaigns, payroll_profiles/records/periods/audit_log, app_settings
- ตาราง campaigns ใน Live ไม่ใช่หลักฐานว่ามี CMO campaign management ครบทั้งบริษัท
- พบ app/api/**/route.ts จำนวน 22 ไฟล์ นี่คือจำนวน route source ไม่ใช่จำนวน Functions ที่ Vercel สร้าง ต้องตรวจผล build ตาม framework แยกจาก Vite

## ข้อสรุปที่ใช้ปรับแผนก่อนหน้า

1. มีเว็บที่ผู้ใช้ระบุและตรวจครั้งนี้ 3 เว็บ ส่วน CMO, Content, CRM, Finance ยังไม่มีเป็นเว็บแยก มีเพียงงานบางส่วน/ต้นแบบอยู่ใน Ops
2. Floor มี 12 API entry files ตามโครงสร้างปัจจุบัน จึงมีเหตุชัดเจนที่จะไม่เพิ่ม API entry ใหม่โดยไม่ตรวจเพดานและผล build ก่อน
3. ระบบยืนยันตัวตนทั้งสามต่างกัน: Ops บัญชีรายคนและ role เดียว; Floor รหัสผ่านร่วม; Live บัญชีผู้จัดการและฟอร์มเปิด จึงยังไม่มีการล็อกอินร่วม หรือการระบุคนเดียวข้ามเว็บ
4. คนกับงานต้องแยกกัน ให้กำหนด person_id กลางและรายการสิทธิ์หลายงานในขั้นออกแบบถัดไป พร้อมเทียบรายชื่อเดิม ไม่จับคนด้วยชื่อแสดงผลอย่างเดียว
5. Ops และ Floor มีงานคน/OT และชื่อชีตซ้อนกัน ต้องระบุผู้เขียนหลักและตรวจฐานจริงก่อนเชื่อม การแสดงหน้าเมนูรวมไม่แก้ข้อมูลเขียนซ้อนกัน
6. งานแรกที่เหมาะสมคือบัญชีระบบและการจับคู่ผู้ใช้ของสามเว็บเดิม แล้วจึงเพิ่มตัวสลับระบบ การล็อกอินร่วม และงานของฉันตามลำดับที่ตรวจได้จริง

เอกสารนี้เป็นผลสำรวจโค้ด ไม่ใช่ผลทดสอบว่า production ทำงานครบ ไม่ยืนยันโควตาฟรี ไม่เปิดเผย secret และไม่เปลี่ยนวิธีล็อกอินเดิม
