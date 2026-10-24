# ตรวจ copied workforce logic

Decision (2026-10-24): คง backend, login, role และธีมของ Ops/Floor ตามเดิม เพิ่มตัวตรวจโค้ดที่คัดลอกกันก่อนพิจารณาย้าย API หากเกิด drift ซ้ำ

รันจาก Ops ก่อนปล่อยการแก้กำลังคน วันลา วันหยุด หรือกฎ OT:

```powershell
npm run check:workforce-drift
```

ค่าเริ่มต้นหา Floor ที่ `../payi-floor` หาก checkout อยู่ที่อื่น:

```powershell
npm run check:workforce-drift -- --floor "C:\path\to\payi-floor"
```

ตัวตรวจอ่าน source เท่านั้น ไม่โหลด `.env`, ไม่เรียกชีท, ไม่รัน application code และไม่แก้ไฟล์ปลายทาง เทียบ AST จึงไม่เตือนจาก comment, formatting, quote style หรือ export wrapper ที่ต่างกัน

| Floor | Ops | ขอบเขต |
| --- | --- | --- |
| `api/_lib/workforce.js` | `api/sheet-tools.js` | 35 declarations ใน manifest: schema, seed, attendance, วันหยุด, วันลา, swap, เวลา OT |
| `api/_lib/scheduleOverrides.js` | ไฟล์ชื่อเดียวกัน | ทุก declaration และ module statements |
| `api/_lib/leaveCoverage.js` | ไฟล์ชื่อเดียวกัน | ทุกส่วนที่คัดลอก ยกเว้น HR helper เฉพาะ Ops ที่ระบุด้านล่าง |

ข้อยกเว้นที่ตั้งใจ:

- workforce: lifecycle ของ cache/ensureSheets และ `getLeaveReadOnly` เฉพาะ Floor
- leaveCoverage: `addToSetMap`, `buildCoveragePlan`, `validateBackupSelections` อยู่เฉพาะ Ops สำหรับจัดคนแทน หาก Floor เริ่มมีฟังก์ชันเหล่านี้ด้วย จะนำมาเทียบตามปกติ
- ไม่เทียบ route handlers, auth, role, React UI หรือ CSS

หาก Floor เพิ่ม declaration ใหม่ใน workforce จะเตือนให้ทบทวน manifest; หากเพิ่มกฎฝั่ง Ops ใน monolith ต้องเพิ่ม declaration ที่ต้องคัดลอกเข้า manifest ด้วย ตัวตรวจเชิง source อาจเตือน refactor ที่ให้ผลเท่าเดิม ต้อง review ก่อนปรับข้อยกเว้น ห้ามเพิ่ม hash ของความต่างเพื่อข้ามการตรวจ

Exit codes:

- `0`: กฎในขอบเขตที่ตรวจตรงกัน
- `1`: พบ drift พร้อมชื่อฟังก์ชัน/ตัวแปรและตำแหน่งไฟล์
- `2`: ตรวจไม่ได้ เช่นไม่มี checkout, อ่านไฟล์ไม่ได้ หรือ syntax error ไม่ถือเป็น pass

เมื่อพบ drift ให้ตรวจว่าเป็น bug fix ที่ควรคัดลอกหรือความต่างที่ตั้งใจ แล้วแก้และรันซ้ำ สคริปต์ไม่คัดลอกอัตโนมัติ เพื่อรักษาขอบเขตสิทธิ์ของ Floor

นี่เป็นคำสั่งตรวจแบบ manual ไม่ใช่ monitor หรือ CI ที่ติดตั้งแล้ว และไม่ได้ผูกกับ Vercel build เพราะแต่ละ deployment ไม่มี sibling checkout หากต้องการใช้ใน CI ต้อง checkout ทั้งสอง repo อย่างชัดเจน

การตรวจนี้ป้องกันการลืมคัดลอกกฎ ไม่ได้ยืนยันข้อมูล production, เวอร์ชันที่ deploy แล้ว, ความสดของ cache หรือความถูกต้องของกฎด้วยตัวมันเอง ใช้คู่กับชุดทดสอบ workforce เดิม
