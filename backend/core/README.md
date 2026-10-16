# MONA Operations

**LINE workflow ล่าสุด:** จดข้อความแท็กโดยไม่จัดหมวด ตอบ `.` และส่งสรุปส่วนตัวพี่หยก ดู [คู่มือจดคำขอ LINE](../../docs/line-notes-guide.th.md) ส่วนหน้าจัดซื้อบนเว็บเดิมยังใช้ได้แยกต่างหาก

Next.js / Express / strict TypeScript / PostgreSQL 18.4 / Ollama พร้อม tenant isolation, accrual profit, payment idempotency, procurement และ LINE Bot จัดซื้อแยกตัว

เริ่มจาก [คู่มือเปิดระบบบนเครื่องร้าน](../../docs/operations-free.th.md) ซึ่งอธิบายบัญชีเริ่มต้น การสำรอง และการตั้งค่าบอทใหม่

จากโฟลเดอร์หลัก mona-ops:

```powershell
npm run ops:start
```

เปิด http://localhost:3000 ฐานถาวรและ AI อยู่ใน .local ซึ่งไม่อยู่ใน Git ไม่มีการสมัครบริการเสียเงิน ข้อมูลเดิมใน Sheets ยังไม่ได้ย้ายเข้า PostgreSQL

- [Backend core](docs/backend-core.th.md)
- [Database blueprint](docs/database-blueprint.th.md)
- [Schema tests](database/tests/RESULTS.md)
- [ผลทดสอบระบบ](tests/RESULTS.md)

LINE ใช้ Channel ใหม่ที่เจ้าของร้านมีอยู่แล้ว ต้องกรอก credentials ในหน้าตั้งค่าและกำหนด public HTTPS URL ก่อนเปิดส่งจริง ไม่มีการต่อพ่วง webhook ของบอทเดิม
