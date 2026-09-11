# ขั้นตอนที่ 1 — Database Schema Blueprint

ชุดนี้เป็น Schema ที่รันได้จริงและทดสอบด้วย PostgreSQL โดยยังไม่สร้าง Backend middleware, API, AI, Cron หรือ LINE Webhook ของขั้นตอนที่ 2–4 ไม่มีโค้ดจำลองหรือ endpoint เปล่า

## สถาปัตยกรรมที่เลือก

- Next.js / React / TypeScript สำหรับ Dashboard และแคตตาล็อก SSR มี URL สินค้าแยกตามบริษัท
- Node.js / Express / TypeScript สำหรับ API และ Webhook แยก process จาก Next.js เพื่อสเกลและควบคุม raw-body signature verification ได้โดยตรง การเลือกนี้ช่วยใช้ภาษาและชนิดข้อมูลร่วมกัน ไม่ได้หมายความว่า Laravel เสถียรน้อยกว่า
- PostgreSQL 17 ขึ้นไปเป็นแหล่งข้อมูลหลัก ใช้ transaction, NUMERIC, Foreign Key, Row-Level Security และบัญชีคู่
- Worker แยก process สำหรับงาน 17:00 น., outbox, import ค่าโฆษณา และ retry Webhook ใช้สถานะใน PostgreSQL เพื่อไม่ให้ deployment หลาย instance ทำงานซ้ำ
- ไฟล์ภาพและบิลเก็บใน private object storage ฐานข้อมูลเก็บ metadata, SHA-256, ผลสแกน และ object key ใต้ prefix บริษัท ดาวน์โหลดผ่าน signed URL หลังตรวจสิทธิ์
- Secret ของ LINE / Payment Gateway / Ads และข้อมูลบัญชีธนาคารใช้ secret-manager reference ไม่ฝัง token หรือเลขบัญชีไว้ใน SQL

## ขอบเขตและสมมติฐานที่ชัดเจน

1. ทุกบริษัทใช้ THB เป็นสกุลบัญชีในรุ่นนี้ บัญชีรับข้อมูลต่างสกุลโดยไม่แปลงไม่ได้ หากต้องรองรับ FX จะเพิ่ม original currency, อัตราแลกเปลี่ยน ณ วันรับรู้ และกำไร/ขาดทุนอัตราแลกเปลี่ยนใน migration ใหม่
2. Identity ผ่าน OIDC/ผู้ให้บริการยืนยันตัวตน โดยเก็บคู่ `auth_issuer` + `auth_subject` ใน `users` ของแต่ละบริษัท บัญชีเดียวเข้าหลายบริษัทได้ผ่าน membership คนละแถว ไม่มี password เปล่าหรือระบบ login จำลอง
3. บริษัทเป็น security boundary; UUID อย่างเดียวไม่ใช่สิทธิ์ ทุก tenant entity ใช้ Primary Key `(company_id, id)` ส่วนตารางเชื่อมใช้ composite key ตามความสัมพันธ์
4. Tenant onboarding และ migration ใช้ control-plane/admin แยก credential จาก runtime แพลตฟอร์ม รายการบริษัทสำหรับ scheduler มาจากทะเบียน tenant ของ deployment/control-plane แล้ว worker เปิด transaction ทีละบริษัท
5. ตารางธุรกรรมไม่ใช้ cascading delete บริษัทที่เลิกใช้งานให้เปลี่ยนสถานะ ขั้นตอน archive/retention เป็นงาน admin ที่ต้องรักษาเอกสารบัญชี
6. รายการเงินที่ระบุ `ex_vat` เป็นฐานก่อน VAT; input/output VAT แยกบัญชี อัตราภาษีและเอกสารที่นำมาเครดิตภาษีได้ต้องตั้งตามธุรกิจ ไม่บังคับ VAT 7% ทุกกรณี

## รายการตารางทั้งหมด 40 ตาราง

| กลุ่ม | ตาราง | หน้าที่ |
|---|---|---|
| องค์กร | companies | บริษัท, tenant slug, สถานะ, timezone, THB |
| ผู้ใช้และ RBAC | users, roles, permissions, user_roles, role_permissions | Membership และสิทธิ์แยกบริษัท |
| แคตตาล็อก | products, product_files | SKU, slug, SEO, ราคา, รูปสินค้า |
| ต้นทุน | product_costs | ประวัติต้นทุนต่อหน่วยตามช่วงเวลา |
| การขาย | customers, orders, order_items | ลูกค้า, วันรับรู้รายได้, รายการขาย, snapshot ต้นทุน |
| บัญชีคู่ | accounts, journal_entries, journal_lines | ผังบัญชีและเอกสารเดบิต–เครดิต |
| ค่าใช้จ่าย | expenses, fixed_costs | ค่าใช้จ่ายที่เกิดขึ้นและเงื่อนไขค่าใช้จ่ายประจำ |
| การตลาด | marketing_campaigns, ad_spends | Meta/TikTok, ค่าใช้จ่ายต่อวันและ revision การนำเข้า |
| เงินรับและค่าธรรมเนียม | payments, gateway_fees | เงินรับจริงและค่าธรรมเนียมแยกวันรับรู้ |
| ลดหนี้และคืนเงิน | credit_notes, credit_note_items, refunds | แยกผลกระทบรายได้, คืนสินค้า และเงินคืน |
| ผู้รับเงิน | payees | ร้านค้า, พนักงาน, ผู้รับเงิน COD |
| จัดซื้อ | purchase_requests, purchase_request_files | ข้อความ, URL, รูปบิล, สถานที่, วันที่, วิธีจ่าย |
| ไฟล์ | files | Metadata ของ private object storage |
| จัดหมวดหมู่ | procurement_classifications | ผล RULES/AI/HUMAN, confidence, รุ่นโมเดล, ผู้ทบทวน |
| จ่ายเป็นรอบ | procurement_batches, procurement_payouts, procurement_batch_items | หนึ่งรอบอนุมัติ หลายผู้รับเงิน และรายการที่รวมอยู่ |
| Integration | integration_connections, webhook_events, idempotency_keys | บัญชีเชื่อมต่อ, verified events, deduplication |
| LINE | line_recipients, line_action_tokens | ผูก LINE กับผู้ใช้ และ token กดปุ่มแบบใช้ครั้งเดียว |
| งานเบื้องหลัง | job_runs, outbox_events | วันทำงาน, retry, lease และข้อความรอส่ง |
| ตรวจสอบ | audit_logs | ประวัติการกระทำแบบเพิ่มอย่างเดียว |

## การแยกข้อมูลบริษัท

ทุกตารางมี `company_id NOT NULL` รวมถึง `companies` ซึ่งใช้ `company_id` เป็น Primary Key และทุก Foreign Key ระหว่างข้อมูลบริษัทมี `company_id` ทั้งสองฝั่ง จึงใช้ `product_id` หรือ `user_id` ของบริษัทอื่นมาเชื่อมไม่ได้

ทุกตารางเปิดทั้ง `ENABLE ROW LEVEL SECURITY` และ `FORCE ROW LEVEL SECURITY` พร้อม `USING` / `WITH CHECK` เมื่อไม่มี tenant context การอ่านได้ศูนย์แถวและการเขียนถูกปฏิเสธ `company_id` ของแถวที่มีอยู่เปลี่ยนไม่ได้

`cmo_owner` เป็น NOLOGIN สำหรับ migration; `cmo_runtime` เป็น NOLOGIN group role ที่ไม่มี SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB และไม่มี DDL หรือ TRUNCATE แอปใช้ login ที่ให้สิทธิ์ผ่าน role นี้เท่านั้น ห้ามให้ runtime เป็นสมาชิก `cmo_owner`

Backend ขั้นตอนที่ 2 ต้องยืนยัน identity และ membership แล้วเรียก `set_config('app.company_id', verifiedCompanyId, true)` **ใน transaction บน connection เดียว** พร้อม `SET LOCAL timezone = 'Asia/Bangkok'` ห้ามใช้ session-level SET ใน pool และห้ามเชื่อถือ company_id จาก request body/header โดยไม่ตรวจ membership

RLS ชั้นนี้ป้องกัน query ที่ขาด tenant filter ไม่ใช่ sandbox สำหรับผู้ถือ credential ที่สามารถรัน SQL อิสระ เพราะ custom setting เปลี่ยนได้โดย role นั้นเอง ต้องปิด SQL injection, parameterize ทุก query และไม่เปิด DB credential ให้ browser ผู้ใช้ สิทธิ์ตาม RBAC ภายในบริษัทต้องบังคับที่ service ในขั้นตอนที่ 2 ด้วย

แคตตาล็อก SSR ให้ server resolve tenant จากโดเมน/slug ที่ยืนยันแล้ว จากนั้นอ่านเฉพาะ published products และ DTO ที่อนุญาต ห้ามให้ browser ต่อ PostgreSQL หรือเปิด anonymous SELECT ตารางทั้งหมด

Webhook ใช้ route ที่มี company_id และ webhook_route_id เพื่อค้น connection **เป็นเพียง routing hint** แล้วตรวจลายเซ็นด้วย secret ของ connection ก่อนบันทึก event หรือแก้ธุรกรรม ห้ามใช้ค่า company_id ภายใน payload เป็นหลักฐานสิทธิ์

## เวลาและ Dynamic COGS

- Database default, DB roles, API/worker environment และ transaction ใช้ `Asia/Bangkok`; Next.js format วันที่ด้วย timezone นี้อย่างชัดเจน
- เหตุการณ์ใช้ `timestamptz` เพื่อเก็บ instant อย่างถูกต้อง PostgreSQL เก็บ instant ภายในแบบ UTC และแสดงตาม timezone; ไม่เปลี่ยนไปใช้ naive timestamp เพื่อให้ตัวเลขดูเป็นเวลาไทย
- วันที่บัญชีใช้ `date`; `orders.recognition_date` และ `purchase_requests.business_date` สร้างจาก `AT TIME ZONE 'Asia/Bangkok'` โดยตรง ไม่ขึ้นกับ timezone ของ client
- ช่วงต้นทุนเป็น `[valid_from, valid_to)`; `valid_to = NULL` หมายถึงต่อเนื่องไม่มีกำหนด ห้ามช่วงซ้อนกันด้วย GiST exclusion constraint
- ก่อนรับรู้การขาย service เลือกต้นทุนที่ `valid_during @> recognized_at` และ snapshot ใน order item ภายใน transaction เดียว หากไม่มีต้นทุนต้องหยุด ไม่ใส่ 0 แทนโดยเงียบ ๆ
- Trigger ตรวจว่า snapshot ตรงกับ cost version และวันรับรู้ หลังรับรู้แล้วแก้ order/item ไม่ได้ ช่วงต้นทุนที่ใช้กับยอดขายเดิมห้ามปรับจนวันขายหลุดจากช่วง และ unit cost เดิมแก้ไม่ได้
- `numeric(20,2)` สำหรับยอดเงินและ `numeric(20,6)` สำหรับจำนวน/ราคาต่อหน่วย ห้าม JavaScript Number คำนวณเงิน ใช้ decimal library หรือ SQL และส่งจำนวนเงินเป็น decimal string ผ่าน API
- ปัดเศษต่อรายการเป็น 2 ตำแหน่งก่อนรวมยอด; discount ไม่เกินฐานรายการ, จำนวนสินค้าต้องมากกว่า 0 และไม่รับ NaN

## บัญชีตามเกณฑ์คงค้างและเงินสด

`ordered_at` คือวันสั่ง, `recognized_at` คือวันที่กิจการส่งมอบ/ทำตามภาระจนรับรู้รายได้ได้ ไม่ใช่เวลารับ Webhook การรับเงินก่อนส่งมอบต้องบันทึกหนี้สินเงินรับล่วงหน้าตาม service policy ไม่ถือเป็นรายได้ทันที

รายงานกำไรอ่าน `journal_entries.status = POSTED` และ `accounting_date` เท่านั้น ไม่บวก orders + expenses + ad_spends + ledger รวมกันจนซ้ำซ้อน ชนิดบัญชีช่วยแยกยอดขาย, ส่วนลด/คืนขาย, COGS, ค่าแอด, Gateway fee และ fixed cost

สูตรเป้าหมายของขั้นตอนที่ 2: ยอดขายสุทธิที่รับรู้ − COGS ที่รับรู้ − ค่าโฆษณา − ค่าธรรมเนียม − ค่าใช้จ่ายประจำที่ปันส่วน − ค่าใช้จ่ายอื่นที่รับรู้ หากยังไม่รวมภาษีเงินได้นิติบุคคลให้ติดป้ายว่า **กำไรก่อนภาษีเงินได้** ไม่เรียกกำไรสุทธิหลังภาษี

ตัวอย่างขายสินค้า 1,000 บาทก่อน VAT ต้นทุน 400 บาท วันที่ 10 แต่รับเงินวันที่ 12: วันที่ 10 ลงเดบิตลูกหนี้/เครดิตรายได้ และเดบิต COGS/เครดิตสินค้าคงเหลือ; วันที่ 12 ลงเดบิตเงินสด/เครดิตลูกหนี้ กำไรเกิดวันที่ 10 เงินสดเข้าเกิดวันที่ 12 ตัวอย่างนี้ยังไม่รวมรายการภาษีหรือค่าธรรมเนียม

Cash Flow ใช้การเคลื่อนไหวของบัญชี `CASH` ใน posted ledger ณ วันเกิดเงินจริง ต้องแยกเงินย้ายระหว่างบัญชีเงินสดไม่ให้นับเป็นรายรับ/รายจ่ายใหม่ Payment Gateway receivable/clearing ใช้บัญชีแยกจากเงินเข้าธนาคารจริง

Journal ต้องสร้างเป็น DRAFT, เพิ่ม lines, แล้ว POSTED ภายใน transaction ตรวจยอดเดบิตเท่ากับเครดิตเมื่อ COMMIT มีอย่างน้อยสอง lines และแต่ละ line มีเดบิตหรือเครดิตด้านเดียว หลังโพสต์แก้หรือลบไม่ได้ ให้สร้าง REVERSAL และรายการแก้ไข พร้อม unique source event ป้องกันโพสต์ซ้ำ

`journal_entries.source_kind/source_id` เป็น business reference หลายชนิด จึงไม่มี polymorphic Foreign Key ข้ามตาราง; service ขั้นตอนที่ 2 ต้องตรวจ source ที่ถูกชนิดและบันทึก source + journal ใน transaction เดียว ส่วน reference แบบระบุตาราง เช่น `expenses.recognition_journal_id` มี composite FK จริง

`fixed_costs` เป็นเงื่อนไขคำนวณ ไม่ใช่ค่าใช้จ่ายที่จ่ายแล้ว worker สร้าง `expenses` รายวันที่ปันส่วนตามจำนวนวันจริงของเดือน/ปี พร้อม journal ความคลาดเคลื่อนจากการปัดเศษลงวันสุดท้าย ช่วง service period ใช้วันเริ่มรวม/วันจบไม่รวม Unique `(company_id, fixed_cost_id, recognition_date)` ป้องกัน accrual ซ้ำ

ค่าแอดจาก API ต้องแปลงช่วงเวลามาเป็นวันไทยก่อนเก็บ `spend_date`; เก็บ `source_timezone` เพื่ออธิบายต้นทาง ถ้าโฆษณาต้นทางรายงานเป็นวันใน timezone อื่นและไม่มีข้อมูลละเอียดพอ ห้ามแค่เปลี่ยนป้ายวันที่ สำหรับ revision ที่ผู้ให้บริการแก้ย้อนหลัง ให้เพิ่ม revision และลง journal ส่วนต่าง/กลับรายการ ไม่รวม revision ทุกแถวเป็นต้นทุนทั้งหมด

การคืนสินค้าใช้ credit note ลดรายได้และคืน COGS เมื่อมีการรับสินค้าคืนจริง; การคืนเงินใช้ `refunds` แยกต่างหาก การรับคืนไม่จำเป็นต้องคืนเงินทันที ขั้นตอนที่ 2 ต้อง lock รายการขาย/การชำระเงินเพื่อตรวจ cumulative credit/refund ไม่เกินยอดเดิม และตรวจ credit note กับ payment ว่ามาจาก order เดียวกัน

## จัดซื้อและ LINE ที่ Schema รองรับ

สถานที่ซื้อมี 4 ค่าแน่นอน:

| ค่าในฐานข้อมูล | ข้อความแสดงผล |
|---|---|
| MARKETPLACE | Shopee/Lazada |
| MAKRO | แม็คโคร |
| LOCAL_SHOP | ร้านหน้าปากซอย |
| MAIN_HOUSE | หยิบจากบ้านใหญ่ |

`suggested_location` เก็บผลที่ระบบเสนอ ส่วน `confirmed_location` เก็บที่พนักงาน/บอสแก้ยืนยัน ไม่ทับข้อมูลกัน ถ้า AI ไม่มั่นใจให้สถานะ NEEDS_REVIEW และบันทึกผลใน `procurement_classifications` โดยไม่อนุมัติเงินจากผล AI

หนึ่ง request แทนของที่ซื้อเป็นรายการเดียวจากผู้รับเงินและวิธีจ่ายเดียว รูปเก็บหลายรูปได้ผ่านตารางเชื่อม รองรับ raw_text ว่างสำหรับการส่งรูปอย่างเดียว แต่ต้องมี title ซึ่ง API สร้างจากข้อความหรือชื่อไฟล์ที่ sanitize แล้ว

Batch มีหลาย payout แยกตามผู้รับเงินและวิธีจ่าย การอนุมัติหนึ่งครั้งอนุมัติได้ทั้งรอบ แต่การโอนจริงอาจหลายรายการ ห้ามสัญญาว่าโอนธนาคารหนึ่งครั้งให้ทุกคนได้โดยยังไม่มี payout provider รองรับ batch transfer

Partial unique index ป้องกันหนึ่ง request อยู่ในหลาย payout ที่ยัง active ต้องบันทึก release reason ก่อนย้ายจากรอบที่ยกเลิก การอนุมัติใช้ actual amount และล็อก request/payout ที่เกี่ยวข้อง หาก actual amount ต่างจากยอดอนุมัติต้องเสนออนุมัติใหม่ ไม่แก้ยอดเงียบ ๆ

สถานะที่แยกไว้: SUBMITTED → NEEDS_REVIEW/APPROVED → PURCHASED → PAID; INTERNAL_STOCK จบที่ FULFILLED ไม่สร้างเงินจ่าย รายการ REJECTED/CANCELLED เก็บประวัติไว้ ขั้นตอนที่ 3 บังคับ transition/ผู้อนุมัติ/ยอดรวม/ผู้รับเงินตรงกัน และ snapshot ยอดให้ immutable หลังอนุมัติ โดยใช้ row lock และ optimistic version

`procurement_payouts` จะ PAID ได้เมื่อมี settlement journal และหลักฐานจาก provider หรือ manual confirmation พร้อมรูปหลักฐานโอน การบันทึกในบริษัทว่าโอนแล้วต้องแยกจากธนาคารยืนยันว่าจ่ายสำเร็จ ปุ่ม “ซื้อแล้ว” ใน LINE สำหรับ COD เปลี่ยนเป็น PURCHASED; ปุ่ม “โอนแล้ว” จึงเข้าสู่การตรวจหลักฐานและลงบัญชี

การลงบัญชีซื้อเกิดเมื่อได้รับสินค้า/บริการตามประเภท หากเป็นอุปกรณ์สิ้นเปลืองอาจเป็น expense; ถ้าเป็น stock/fixed asset ต้องลงสินทรัพย์ตามประเภท ไม่เดบิต expense ทุก request ส่วนตอนจ่ายเดบิตเจ้าหนี้/เครดิตเงินสด จึงไม่หักต้นทุนซ้ำสองครั้ง

`job_runs` มี unique บริษัท/ชื่องาน/วัน และ outbox มี deduplication key เก็บข้อความใน transaction ก่อนส่ง LINE นอก transaction ใช้ lease + retry ให้กู้ได้เมื่อ worker ตาย การส่งออกภายนอกเป็น at-least-once และใช้ retry key ของ provider เมื่อรองรับ ไม่อ้างว่า exactly-once ผ่านเครือข่าย

Cron ขั้นตอนที่ 4 กำหนด 17:00 Asia/Bangkok แสดงรายการวันนี้และแยกหมวดค้างเก่าที่ต้องตามต่อ เพื่อไม่ให้ของเมื่อวานหายไป token ปุ่มเก็บเป็น SHA-256 มีวันหมดอายุ, recipient, target และ consumed_at; ต้องตรวจ LINE signature, ผูกผู้ใช้, ตรวจ RBAC ณ เวลากด และ consume token ภายใน transaction เดียวกับเปลี่ยนสถานะ

## ไฟล์และการใช้งาน

- `database/bootstrap.sql`: ตั้ง role, timezone, extension, schema ใช้กับฐานข้อมูลใหม่เฉพาะระบบนี้
- `database/migrations/0001_initial.sql`: ตารางทั้งหมด, constraints, indexes, RLS และ integrity triggers
- `database/schema.sql`: รวมสองไฟล์ด้านบนสำหรับอ่าน/รันต่อเนื่องครั้งเดียว สร้างจาก source เดียวกัน ไม่ใช้รันซ้ำกับฐานข้อมูลที่ migrate แล้ว
- `database/tests/verify.mjs`: ทดสอบกับ PostgreSQL จริงในฐานข้อมูลชั่วคราวบน loopback
- `database/tests/RESULTS.md`: ผลการรันทดสอบล่าสุด

รันด้วย `psql` บน dedicated database โดยตั้ง `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` ของ admin/migrator และใช้ `.pgpass` หรือ secret injection ตาม deployment:

```sh
psql -X -v ON_ERROR_STOP=1 -f database/schema.sql
```

Provision login ของ application ด้วย credential จริงจาก secret manager และ grant `cmo_runtime` ให้ login นั้นโดย deployment admin การรันทดสอบใช้ `npm ci` แล้ว `npm test` ภายใน `database/tests` มี lockfile กำกับ dependency; embedded PostgreSQL package ใช้เฉพาะการทดสอบ ไม่ใช่ production server และไม่ใช้ข้อมูลบริษัทจริง

Production readiness ของทั้งแอปยังต้องผ่านขั้นตอนที่ 2–4 รวม auth/RBAC, gateway signature และ reconciliation, concurrency/replay tests, backup/restore และการทดสอบร่วม LINE Bot เดิม ชุดนี้พิสูจน์เฉพาะ SQL และ database invariants ที่ระบุในผลทดสอบ

## เอกสารอ้างอิง

- PostgreSQL Row Security: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- PostgreSQL Date/Time: https://www.postgresql.org/docs/current/datatype-datetime.html
- PostgreSQL Range Types: https://www.postgresql.org/docs/17/rangetypes.html
- PostgreSQL Constraint Triggers: https://www.postgresql.org/docs/17/sql-createtrigger.html
