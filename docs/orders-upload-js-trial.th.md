# Upload session และตัวนำเข้า JS — ทดลองในเครื่อง

## ขอบเขตที่ผู้ใช้ยืนยัน: บอสต้องใช้งานระบบปัจจุบันต่อได้

- งานย้ายฐานนี้ห้ามเขียนชีทจริง เปลี่ยน API/หน้า Upload ที่ใช้อยู่ หรือ push/deploy สลับระบบจนกว่าผู้ใช้จะอนุมัติการสลับอย่างชัดเจน
- โค้ดทดลองอยู่ scripts/lib และฐานทดลองอยู่ tmp/orders-sqlite; ไม่ได้ import จาก src, api, vite.config.js หรือ package.json
- ตัวนำเข้าปฏิเสธการรันเมื่อ NODE_ENV=production หรืออยู่ใน Vercel และตรวจ marker ของฐานเดิมแบบ read-only ก่อนอนุญาตให้เขียน
- ฐาน v3 และฐาน JS ทดลองเก่าที่สร้างก่อนมี marker จะเปิดเขียนด้วยตัวใหม่นี้ไม่ได้ ให้เก็บหลักฐานเดิมและใช้ชื่อฐานทดลองใหม่ ไม่เติม marker ให้ฐานอื่นเพื่อข้ามการป้องกัน
- หน้า Upload ทดลองในงานถัดไปต้องใช้ทางเข้าและฐานแยก มีป้ายทดลองชัดเจน และมีปุ่มนำเข้าที่เรียกเฉพาะ backend ทดลอง
- Commit เป็นการเก็บประวัติในเครื่องเท่านั้น งานนี้ยังไม่ push/deploy การเปิดใช้งานออนไลน์และการย้อนระบบต้องผ่านเกณฑ์ในแผนก่อน

24 กันยายน 2026 ใช้ Node 24.18.0 กับ `node:sqlite` ที่มีใน runtime ไม่เพิ่ม dependency หรือเปลี่ยน API จริง ตัวนี้เป็นโมดูลทดลองที่เก็บข้อมูลถาวรใน SQLite ยังไม่ใช่หน้าเว็บหรือ HTTP service และยังไม่มี libSQL/Turso adapter

## ผลตรวจ

- ใช้ snapshot สิงหาคมหลังแก้รหัสแล้ว: 39,989 แถว ยอด 7,038,364.11 บาท จำนวน 42,765 ชิ้น
- ส่ง chunks ย้อนลำดับและ retry แล้ว finalize ได้ นำเข้าทั้งไฟล์สลับลำดับซ้ำอีกครั้งไม่เพิ่มยอดครบ 39,989 แถว
- เทียบกับ Python v3 แยกวัน/ช่องทาง/ธุรกิจ/SKU ตรง 3,862 กลุ่ม และตรวจ normalized payload ของทุกรายการด้วย
- เทสต์ใหม่ 11 กรณี และเทสต์เดิมเรื่อง L ข้าม batch 5 กรณี ผ่านรวม 16 กรณี
- ทดสอบปิด/เปิดฐานแล้วกลับมาส่งต่อ ตรวจเจ้าของ session และจำลองฐานล้มเหลวกลางการบันทึกเพื่อยืนยัน rollback

ผลทดลองอยู่ `tmp/orders-sqlite/orders-upload-js-v1.sqlite` และ `.report.json` / `.report.verified.json` ไม่รวมใน Git ผลรายงานครั้งนี้ไม่ใช่การสำรองฐาน JS หรือการทดสอบกู้คืนจาก backup; ทดสอบ persistence โดยเปิดฐานเดิมใหม่แล้ว ส่วน backup ที่เคยผ่านเป็นของฐาน Python v3

## สัญญาการเรียกใช้งาน

โมดูล `scripts/lib/orders-upload-store.mjs` ส่งออก `OrdersUploadStore`:

1. `create(owner, requestKey, manifest)` → upload ID; เรียกซ้ำด้วย requestKey และ manifest เดิมได้ ID เดิม หากเนื้อหาต่างให้ conflict
2. `putChunk(owner, id, index, rows)` → รับ normalized sheet rows ไม่เกิน 1,000 แถว / 2 MB ต่อชุด; index เริ่ม 0; ชุดซ้ำเนื้อหาเดิมตอบรับได้; เปลี่ยนเนื้อหาชุดเดิมไม่ได้
3. `status(owner, id)` → สถานะ จำนวนแถวที่รับแล้ว เลข chunks ที่ได้รับ ผลนำเข้าและรหัสข้อผิดพลาด
4. `finalize(owner, id)` → ตรวจจำนวน chunks/rows, payloadHash, platform/business, รหัสรายการ และจับคู่ครบ ก่อนเผยแพร่ด้วย transaction เดียว
5. `undoLatest(batchId)` → คำสั่งภายในที่ต้องครอบด้วยสิทธิ์ผู้ดูแลเมื่อทำ API; ย้อนเฉพาะล็อตล่าสุด เปลี่ยนสถานะ sessions ที่เกี่ยวข้องเป็น undone และเก็บประวัติไว้

manifest: `{ platform, business, parserVersion: 'sheet-v3', expectedChunks, expectedRows, payloadHash }` โดย payloadHash คือ SHA256 ของ normalized rows ทั้งไฟล์ตาม canonical JSON ของโมดูล **ไม่ใช่ hash ของไฟล์ XLSX ดิบ** แยกหนึ่ง session ต่อ platform/business; ตัว runner แบ่ง snapshot หลายช่องทางเป็น sessions ให้

ข้อมูลสถานะ: receiving → complete หรือ blocked; ข้อมูลขาดยังเป็น receiving และส่งต่อได้ หลัง undo เป็น undone ชุดที่ blocked ต้องตรวจแก้และสร้าง session ใหม่ ยังไม่มีหน้าจอแก้ mapping หรือ replay ล็อตที่ undo แล้ว

errors: INVALID = รูปแบบผิด, INCOMPLETE = รับยังไม่ครบ, CONFLICT = คำขอขัดกับสถานะ, REVIEW = ต้องตรวจตัวระบุรายการ, NOT_FOUND = ไม่พบ session ของเจ้าของที่ระบุ

`owner` ต้องมาจากผู้ใช้ที่ยืนยันตัวตนฝั่ง server เมื่อเชื่อม API ห้ามรับค่าจาก body แล้วเชื่อทันที การทดสอบ owner isolation ในโมดูลยังไม่ใช่ระบบ login/permission พร้อมใช้งานออนไลน์

## ขอบเขตที่ต้องทำต่อ

- เชื่อม parser ของไฟล์ marketplace จริงเข้ารูปแบบ normalized rows และทำ integration test กับไฟล์ export จริง
- แยก storage adapter สำหรับโฮสต์ที่เลือก `node:sqlite` ใช้กับไฟล์บนเครื่องนี้ ไม่ใช่ฐานถาวรบน serverless และยังไม่ได้ทดสอบกับ Cloudflare Workers
- ออกแบบ finalize แบบเผยแพร่เป็นรุ่นสำหรับคลาวด์ ไม่ยก transaction ทั้งไฟล์ในเครื่องไปใช้โดยตรง
- ทำ API ผ่าน endpoint เดิมตามแนวทางโปรเจกต์ พร้อม requireDev/session owner แล้วจึงต่อหน้า Upload ทดลอง
- เพิ่ม cleanup/retention ของ chunks และ session, backup/restore ของฐาน JS, รายงานตรวจสอบก่อน finalize, และ policy ขนาดรวมต่อผู้ใช้ก่อนออนไลน์

## คำสั่งทดสอบ

```powershell
node --test test/ordersUploadStore.test.mjs test/orderLines.test.js
node scripts/rehearse-orders-upload.mjs tmp/orders-sqlite/2026-08.json tmp/orders-sqlite/orders-upload-js-v1.sqlite
python scripts/verify_orders_js_report.py tmp/orders-sqlite/orders-upload-js-v1.sqlite.report.json tmp/orders-sqlite/orders-import-v3.sqlite tmp/orders-sqlite/orders-upload-js-v1.sqlite
```

runner ไม่ทับฐานเดิม ให้ใช้ชื่อใหม่เมื่อต้องรันทดลองซ้ำ โปรแกรมทดลองไม่เปิด HTTP port ไม่อ่าน `.env` และไม่เขียนชีท/Turso

## โฮสต์ฟรี: ผลตรวจเบื้องต้น

Cloudflare Pages/Workers เป็นตัวเลือกที่ต้องตรวจต่อ ยังไม่ประกาศเป็นโฮสต์ที่ผ่านทั้งหมด Workers Free มี 100,000 requests/วัน และ CPU 10 ms/request ตาม [ราคา](https://developers.cloudflare.com/workers/platform/pricing/) และ [ข้อจำกัด](https://developers.cloudflare.com/workers/platform/limits/) ที่อ่านวันที่ 24 กันยายน 2026 การตรวจครั้งนี้ยังไม่ยืนยันเงื่อนไขเชิงพาณิชย์ของผลิตภัณฑ์ที่เลือกและความเข้ากันได้กับ API เดิม จึงยังไม่ย้ายเว็บหรือสมัครแผนใด
