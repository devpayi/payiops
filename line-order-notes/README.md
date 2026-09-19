# LINE จดคำขอร้าน — Google Apps Script + Sheets

ทดแทน `backend/core` LINE workflow เดิม ด้วยของที่รันฟรีตลอดเวลาไม่ต้องเปิดเครื่องร้าน
(ไม่แตะ `backend/core` — ของเดิมยังอยู่เผื่อใช้งานอื่น)

Sheet: https://docs.google.com/spreadsheets/d/1R-Qq5PfJIlqEZd-x4Js3RZV1H5OEeQLTs0m4rs6yTeM/edit

## ติดตั้ง (ทำครั้งเดียว)

1. เปิด Sheet ด้านบน → Extensions (ส่วนขยาย) → Apps Script
2. ลบโค้ดเดิมใน `Code.gs` แล้ววางเนื้อหาจาก `Code.gs` ในโฟลเดอร์นี้ทั้งไฟล์
3. Project Settings (เฟือง) → Show "appsscript.json" → วางเนื้อหาจาก `appsscript.json` ทับ
4. Project Settings → Script Properties → เพิ่ม
   - `CHANNEL_ACCESS_TOKEN` = long-lived channel access token ของ LINE Channel
   - `BOSS_USER_ID` = LINE userId ของบอส (ขึ้นต้น `U` + hex 32 ตัว)
   - `WEBHOOK_KEY` = (แนะนำ) รหัสสุ่มยาวๆ เช่น 32 ตัวอักษร ถ้าตั้งไว้ ต้องต่อท้าย Webhook URL ด้วย
5. รันฟังก์ชัน `setupSheets` หนึ่งครั้ง (ขอ authorize ครั้งแรก: Advanced → Go to project) แล้วรัน `setupTriggers` หนึ่งครั้ง (ตั้งสรุป 17:00 + เตือนซ้ำ 10:00)
6. Deploy → New deployment → Web app → Execute as: **Me**, Who has access: **Anyone**
7. คัดลอก URL ที่ลงท้าย `/exec` → LINE Developers → Messaging API → Webhook URL
   (ถ้าตั้ง `WEBHOOK_KEY` ให้ใส่ `https://script.google.com/macros/s/.../exec?key=<รหัส>`) → เปิด **Use webhook**
8. แก้โค้ดภายหลัง: ต้อง Deploy → Manage deployments → ดินสอ → Version: New version ทุกครั้ง ไม่งั้นของเก่ายังทำงานอยู่

**ปุ่ม Verify ใน LINE จะขึ้น "302 Found" เสมอ — ปกติ ไม่ใช่ error ของเรา** Apps Script ตอบ 302 redirect ทุกครั้ง
แต่สคริปต์รันจบตั้งแต่ request แรก (บันทึกชีต + ตอบไลน์) event จริงจึงทำงานได้ ไม่ต้องสนใจปุ่ม Verify

## วิธีใช้

- แท็กบอทในกลุ่ม + ข้อความคำขอ (@ ตรงไหนก็ได้ ไม่ติดไปในข้อความ) → บอทตอบ "จดแล้ว" ครั้งแรกที่แท็กจะผูกกลุ่มนั้นเป็นกลุ่มร้าน
- ถ้า LINE ของใครไม่โชว์ชื่อบอทตอนพิมพ์ @ ให้พิมพ์ `#สั่ง` ขึ้นต้นแทน เช่น `#สั่ง กล่องส้น 10 ใบ` (ไม่ต้องแท็ก) ข้อความที่ไม่ได้ขึ้นต้นด้วย `#สั่ง` หรือ `/สั่ง` บอทไม่สนใจ
- แก้ไข/ยกเลิก: quote (reply) ข้อความเดิม + แท็กบอท + ข้อความใหม่ (หรือพิมพ์ "ยกเลิก") เฉพาะผู้ขอหรือบอส
- บอสแชทส่วนตัวหาบอทพิมพ์ **ต้องสั่ง** → การ์ดงานค้าง (ปุ่ม สั่งแล้ว / รอไปเอา / เลื่อนเตือน / ยกเลิก / ทำแล้วทั้งหมด)
- บอสพิมพ์ **สั่งแล้ว** ในแชทส่วนตัว → การ์ดงานที่สั่งแล้ว/รอไปเอา 7 วันล่าสุด มีปุ่ม **ย้อนกลับ** (กลับไปเป็นงานค้าง) และ **ยกเลิก**
- ระบบส่งสรุปให้บอสอัตโนมัติ 17:00 และเตือนงานค้างจากก่อน 17:00 เมื่อวานอีกรอบ 10:00 (ไม่ส่งถ้าไม่มีงาน)

## ก่อนใช้จริง

- หา userId ของบอส: ให้บอสแอดบอทเป็นเพื่อน แล้วพิมพ์ `myid` ในแชทส่วนตัว บอทจะตอบ userId กลับมา → ใส่ใน `BOSS_USER_ID`
- ลิงก์แอดเพื่อน: https://line.me/R/ti/p/%40061kworu (ไอดีบอท @061kworu) หรือใช้ QR จาก LINE Developers → Messaging API
- เปลี่ยน token: LINE Developers → Messaging API → Channel access token (long-lived) → Reissue → วางใน `CHANNEL_ACCESS_TOKEN` (อันเก่าใช้ไม่ได้ทันที)

## ข้อจำกัดที่ต้องรู้

- **ตรวจลายเซ็น LINE (HMAC) ไม่ได้** — Apps Script `doPost` มองไม่เห็น HTTP header ตัวป้องกันคือ URL ที่เดายาก + `WEBHOOK_KEY`
  เหมาะกับงานจดโน้ต ไม่ควรผูกกับเงินจริง ถ้าอยากตรวจลายเซ็นจริง ใช้ `worker.js` (Cloudflare Worker ฟรี) คั่นหน้า —
  **ยังไม่เคยทดสอบครบวงจรกับ LINE จริง** ไม่จำเป็นสำหรับการใช้งานปกติ
- ปุ่มบนการ์ดไม่หมดอายุ แต่กดซ้ำ/กดหลังงานถูกแก้ไขแล้วจะขึ้น "รายการเปลี่ยนแปลงหรือจัดการไปแล้ว" ไม่ทำรายการซ้ำ
- ผูกได้ 1 กลุ่ม (กลุ่มแรกที่แท็กหลังล้างข้อมูล) กลุ่มอื่นแท็กแล้วบอทตอบว่ายังไม่เปิดใช้งาน ถ้าจะเปลี่ยนกลุ่ม ให้ลบแถวในแท็บ `groups` (เก็บหัวตารางไว้) แล้วแท็กในกลุ่มใหม่ ถ้าจะใช้หลายร้านต้องทำชีต+สคริปต์แยก
- ทดสอบกับ mock ครบทุกเส้นทาง (25 กรณี) + ตรวจโครงสร้างการ์ดกับ LINE validate API แล้ว
  แต่ปุ่มบนการ์ดใหม่ (ขนาด giga) ยังไม่เคยเห็นบนมือถือจริง

## ทดสอบในเครื่องโดยไม่ต้องใช้ LINE

แก้ `Code.gs` แล้วรันก่อน deploy ทุกครั้ง:

```bash
node harness.cjs                       # จำลอง Sheet + LINE API ในเครื่อง 25 กรณี
LINE_TOKEN=<channel token> node harness.cjs   # + ส่งการ์ดทุกแบบให้ LINE validate API ตรวจ (ไม่ส่งข้อความจริง)
```
