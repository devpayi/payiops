# Financial Core ในโปรเจกต์ร้าน

อัปเดต 11 กันยายน 2026: ระบบ Next.js, ฐาน PostgreSQL ถาวร, AI ในเครื่อง และโมดูลจัดซื้อ/LINE ถูกเพิ่มแล้ว ดู [คู่มือปัจจุบัน](operations-free.th.md) ส่วนเอกสารด้านล่างเก็บรายละเอียด bridge ของแอป Vite/Sheets เดิม ไม่ใช่ขั้นตอนเปิดเว็บใหม่

## ผลตรวจเดิมวันที่ 10 กันยายน 2026 (ข้อมูลประวัติ)

ไม่พบ DATABASE_URL หรือการตั้งค่า PostgreSQL ในไฟล์ environment ของโปรเจกต์ที่ตรวจ และไม่พบ PostgreSQL service/process/listener ในเครื่องที่ตรวจ การทดสอบสร้าง PostgreSQL 18.4 ชั่วคราวที่ localhost:55440 แล้วหยุดเมื่อเสร็จ จึงไม่ใช่ฐานข้อมูลถาวรของร้าน

## ตรวจโค้ดจากโฟลเดอร์ mona-ops

```powershell
npm run core:install
npm ci --prefix backend/core/database/tests
npm run core:typecheck
npm run core:build
npm run core:test
npm test
npm run build
```

ต้องใช้ Node.js 24 ขึ้นไปสำหรับการ import TypeScript bridge โดยตรงใน dev server เดิม โค้ดนี้ใช้ syntax ที่ Node ลบ type ได้ ส่วน strict type checking ทำด้วย `core:typecheck` ก่อนนำไปใช้งานเสมอ Tests PostgreSQL ใช้ binary สำหรับ Windows และต้องมี port 55440 ว่าง

## จุดเชื่อม Login เดิม

เรียกผ่าน endpoint เดิมเพื่อไม่เพิ่มจำนวน serverless functions:

- `GET /api/sheet-tools?op=financial-core&view=status` แสดงชื่อ configuration ที่ขาด โดยไม่แสดงค่า secret หรืออ้างว่าเชื่อม DB สำเร็จ
- `GET /api/sheet-tools?op=financial-core&view=profit&orderId=<UUID ของ order ใน PostgreSQL>` อ่านกำไรจาก Core

Frontend เดิมส่ง `x-api-token` อยู่แล้ว Bridge ตรวจ token เดิม และอ่านรายการ users เพื่อตรวจบทบาท Dev อีกครั้ง โดยการอ่าน users ใช้ Sheets cache เดิมสูงสุด 5 นาที การยกเลิกสมาชิก PostgreSQL มีผลเมื่อ query ถัดไปตรวจ membership ระบบนี้ไม่ข้าม authentication แม้โหมด dev เดิมจะอนุญาตให้ใช้แอปโดยไม่มี AUTH_SECRET

Bridge ลงนาม RS256 อายุ 60 วินาทีด้วย company ที่กำหนดฝั่ง server เท่านั้น Core ตรวจลายเซ็น issuer/audience, active membership และ permission `finance.profit.read` อีกชั้น ไม่มีการแปลง role จาก token ให้เป็นสิทธิ์ PostgreSQL โดยอัตโนมัติ

## Configuration ก่อนเปิดใช้งานจริง

ฝั่ง mona-ops ต้องตั้ง AUTH_SECRET ที่ใช้งานจริง และตัวแปร server ต่อไปนี้ (ห้ามใช้ prefix VITE_):

| ตัวแปร | ความหมาย |
|---|---|
| MONA_CORE_URL | Origin ของ Express; ใช้ HTTPS ยกเว้น localhost |
| MONA_CORE_COMPANY_ID | UUID บริษัทที่สร้างใน PostgreSQL |
| MONA_CORE_JWT_PRIVATE_KEY | RSA private key PEM อย่างน้อย 2048 bits |
| MONA_CORE_JWT_KEY_ID | ชื่อ key สำหรับ rotation |
| MONA_CORE_JWT_ISSUER | Issuer ที่ Core ยอมรับ |
| MONA_CORE_JWT_AUDIENCE | Audience ที่ Core ยอมรับ |

ฝั่ง Core ต้องตั้ง `DATABASE_URL`, `JWT_ISSUER`, `JWT_AUDIENCE` และเลือก `JWT_PUBLIC_JWK` (JSON public RSA JWK มี kid ตรงกับ bridge) หรือ `JWT_JWKS_URL` (HTTPS) อย่างใดอย่างหนึ่งเท่านั้น ไม่ส่ง private key ไปยัง Core

สร้าง membership ใน `app.users` โดย `auth_issuer` ตรงกับ issuer และ `auth_subject` เป็น username ของร้านที่ trim และ lowercase พร้อม role/permission ที่บริษัทนั้นกำหนด ห้ามใช้บัญชี database admin เป็น runtime ดูลำดับ bootstrap/migrations, TLS และการจัดการ credentials ใน [คู่มือ Backend](../backend/core/docs/backend-core.th.md)

Core อ่าน environment ของ process จึงต้อง export ค่าใน terminal/service ก่อน `npm run core:start`; คำสั่งนี้ไม่โหลดไฟล์ .env ของแอปร้านโดยอัตโนมัติ

## ข้อมูลที่ต้องพร้อมสำหรับกำไรจริง

Order ต้องมี UUID ของ PostgreSQL, วันรับรู้รายได้, ยอดก่อน VAT, item cost snapshot และประวัติ product_costs ที่ครอบคลุมเวลาขาย พร้อม posted journal ที่ตรงกัน ค่าแอด ค่าใช้จ่ายคงที่ และค่าธรรมเนียมต้องนำเข้าพร้อมช่วงเวลาและแหล่งอ้างอิง การนำ rawOrders จาก Sheets มาลงอย่างเดียวไม่เพียงพอ ห้ามเติมต้นทุนศูนย์เพื่อให้รายงานผ่าน

404 หมายถึงไม่พบ order; 409 หมายถึงเงื่อนไขรับรู้รายได้หรือข้อมูลบัญชียังไม่ครบ/ไม่ตรงกัน; 503 จาก bridge หมายถึง configuration ยังขาด; 502 หมายถึง Core หรือบริการตรวจสอบผู้ใช้ไม่พร้อม ไม่ควรตีความข้อผิดพลาดเป็นกำไรศูนย์

Dashboard CFO เดิมยังอ่านข้อมูลเดิม หน้า accrual report และ Next.js catalog อยู่ในเว็บใหม่ที่ localhost:3000 ผลทดสอบ gateway ใช้ข้อมูลลายเซ็นทดสอบ ไม่ใช่รายการเงินจริง

## ผลตรวจในโปรเจกต์นี้

- Strict TypeScript และ build Core ผ่าน
- Core + bridge + procurement tests 35/35 ผ่านบน PostgreSQL 18.4 (11 กันยายน 2026)
- Tests แอปร้านเดิม 21/21 ผ่าน
- Vite production build ผ่าน มีคำเตือนขนาด bundle บางไฟล์เกิน 500 kB
- ติดตั้งและตรวจ PostgreSQL ถาวรแล้ว ยังไม่ได้ deploy สาธารณะหรือทดสอบ merchant credentials จริง
