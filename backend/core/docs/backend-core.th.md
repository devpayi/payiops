# ขั้นตอนที่ 2 — Backend Core Logic

โค้ดใหม่ทั้งหมดเป็น TypeScript strict: `packages/db`, `packages/money`, `apps/api`, และ integration tests ใช้ Express 5, node-postgres, jose, Stripe SDK และ decimal.js ไม่มี frontend จำลอง ขั้นตอนนี้สร้าง API ที่ Next.js เรียกฝั่ง server ได้; ยังไม่สร้างหน้า Next.js หรืองาน AI/LINE ของขั้นตอนที่ 3–4

## ไฟล์หลักสำหรับตรวจ

| ไฟล์ | หน้าที่ |
|---|---|
| `packages/db/src/client.ts` | Private pool, AsyncLocalStorage, ตรวจ runtime role, transaction บน connection เดียว |
| `packages/db/src/sql.ts` | Tagged SQL ที่ bind ทุก interpolation และปิดช่องทาง raw string |
| `apps/api/src/middleware/tenant.ts` | ตรวจ JWT, เลือกบริษัท, ตรวจ membership และ RBAC |
| `apps/api/src/middleware/idempotency.ts` | Claim, 409, cached response, transaction adapter และ recovery |
| `apps/api/src/modules/integrations/verification.ts` | ตรวจความแท้ของ Stripe / Omise / 2C2P ก่อนสร้าง idempotency record |
| `apps/api/src/modules/integrations/payments.ts` | รับรู้เงินที่ Gateway เก็บแล้ว พร้อมบัญชีลูกหนี้/เงินรับล่วงหน้า |
| `packages/money/src/calculator.ts` | `calculateActualProfit(companyId, orderId)` |
| `packages/money/src/decimal.ts` | Decimal 60-digit precision และการปันส่วนระดับสตางค์ |
| `apps/api/src/app.ts` | ผูก middleware กับ routes จริง |
| `apps/api/src/server.ts` | Configuration, verified TLS, startup check และ graceful shutdown |
| `database/migrations/0002_backend_core.sql` | response_text และบัญชีที่ใช้รับชำระเงินต่อ connection |
| `tests/integration/core.test.ts` | Integration tests ต่อ HTTP + PostgreSQL จริง |

## Tenant context

1. HTTP API รับ `Authorization: Bearer …` และใช้ JWT ที่ตรวจลายเซ็นด้วย JWKS, issuer, audience, exp, iat, sub ผ่านแล้วเท่านั้น อนุญาต RS256/ES256, อายุ token ไม่เกินหนึ่งชั่วโมง, clock tolerance 5 วินาที
2. ถ้า JWT มี `company_id` ใช้ค่านั้น ถ้ามี `X-Company-Id` ด้วยต้องตรงกัน ถ้า JWT ไม่มี company claim ใช้ header เลือกบริษัทแล้วตรวจ active membership จาก issuer/subject ในฐานข้อมูล Header อย่างเดียวเข้าไม่ได้
3. ตรวจก่อนว่าบริษัท ACTIVE และ user ACTIVE จากนั้นผูก company กับ AsyncLocalStorage ที่มี AbortSignal ของ request
4. `db.query(sql\`…\`)` ทุกครั้งจะเข้า transaction ที่ตั้ง `SET LOCAL ROLE cmo_runtime`, `app.company_id`, `TimeZone=Asia/Bangkok`, search_path และ timeout ให้ก่อน หากอยู่ใน transaction เดิมจะใช้ connection เดิม
5. Nested transaction เข้าร่วม transaction แม่ ไม่สร้าง commit แยก ถ้ามีข้อผิดพลาดที่ถูก catch ไว้ transaction แม่ก็ต้อง rollback; ไม่เปลี่ยน isolation หรือสลับ tenant กลาง transaction
6. การเรียกโดยไม่มี scope, company argument ไม่ตรง scope, หรือ request จบ/ถูกตัดการเชื่อมต่อ จะถูกปฏิเสธ ห้ามใช้ fire-and-forget query; ทุก query ต้อง await

Pool ไม่ถูก export และไม่มี `pool.query()` ให้ repository ใช้ ค่าเงินจาก NUMERIC คงเป็น string การตรวจ runtime role ทำทั้งตอน startup และตอน checkout: ไม่รับ superuser, BYPASSRLS, owner membership, role ที่สร้าง role/database ได้ หรือ app table ที่ไม่ได้ FORCE RLS

`runAsTenant` เป็น trusted server entry point สำหรับ middleware และงานภายใน ไม่ใช่ฟังก์ชันสำหรับส่ง company_id ที่ browser ขอมาแล้วเชื่อทันที RLS และ wrapper ป้องกันลืม filter/สลับ context; ไม่ใช่ sandbox สำหรับผู้ที่ครอบครอง DB credential หรือรัน SQL อิสระ โค้ด repository เป็น trusted code และค่าภายนอกต้องผ่าน bind parameters เสมอ

## Idempotency: ขอบเขตการรับประกัน

ใช้ middleware เป็นคู่ตาม route ใน `app.ts`:

`raw body → verifyPaymentWebhook → idempotency → transactionalWebhookHandler → paymentProcessor`

`idempotency` เรียก `next()` เฉพาะ claim ใหม่หรือ claim ที่กู้คืนได้ Route handler สุดท้ายรับ processor ที่ **คืนค่า `{status, body}`** แทนการรับ `Response` ไปส่งเอง จึงควบคุม commit-before-response ได้ ไม่ใช้ `res.on('finish')` เพื่อค่อยบันทึกผลภายหลัง ห้ามแทน handler คู่นี้ด้วย callback ที่ส่ง `res.json()` เอง

| สถานะ | ผลลัพธ์ |
|---|---|
| กำลังทำงาน/มี transaction จับ lock | 409 `IDEMPOTENCY_IN_PROGRESS`, Retry-After 2 วินาที |
| สำเร็จแล้วและ fingerprint เดิม | คืน status/body bytes ที่บันทึกไว้ โดยไม่เรียก processor |
| key เดิมแต่ข้อมูลที่ยืนยันแล้วต่างกัน | 409 `IDEMPOTENCY_PAYLOAD_CONFLICT` |
| ยังไม่เคยเห็น key | สร้าง PROCESSING พร้อม ownership token และ lease 30 วินาที แล้ว `next()` |
| process ตายก่อนเริ่มงานและ lease หมด | เปลี่ยน ownership token แล้วทำต่อได้ |
| processor หรือ COMMIT ล้มเหลว | rollback ทั้ง ledger/payment/inbox/cache; คืน error และเปิดให้ retry |

ช่วง claim ใช้ `pg_try_advisory_xact_lock` ปิด race ก่อน INSERT และ `FOR UPDATE NOWAIT` เพื่อตอบ 409 โดยไม่รอ ส่วนช่วงประมวลผลจับ row lock ของ claim ตลอด transaction ดังนั้น lease หมดเวลาแล้วก็ขโมยงานที่ transaction ยังทำอยู่ไม่ได้

Ledger, payments, audit, webhook_events และ Cached Response เขียนใน **transaction เดียว** เสมอ ยอดที่ลงบัญชีแล้วแต่ client ไม่ได้รับ response สามารถ retry เพื่ออ่าน cache ได้ ถ้าไม่แน่ใจว่า COMMIT สำเร็จหรือไม่ ห้ามชดเชยด้วยการรันงานใหม่ทันที ให้ retry ผ่าน key เดิม

รักษา key สำหรับ payment ไว้ด้วย `expires_at='infinity'` ไม่ลบทิ้งด้วย TTL แม้ cache สูญหาย `webhook_events` และ unique payment/source journal ยังเป็นอีกชั้นที่ป้องกันการลงเงินซ้ำ เหตุการณ์ต่าง event ID ที่อ้าง payment เดียวกันถูกป้องกันด้วย row lock ของ order/payment และ unique capture source

การรับประกันนี้ครอบคลุม **ผลใน PostgreSQL ที่อยู่ใน transaction นี้** ไม่ได้ทำให้เครือข่ายหรือการโอนธนาคารภายนอกกลายเป็น exactly-once Processor ไม่ควรส่ง LINE/โอนเงินจริงภายใน transaction ให้เขียน outbox และใช้ idempotency ของปลายทางสำหรับผลภายนอก

## การยืนยัน Gateway

- Stripe: ใช้ `constructEvent` ตรวจ raw bytes กับ Stripe-Signature, timestamp tolerance 300 วินาที, livemode และ account เมื่อเป็น Connect Event ใช้ event.id เป็น key ถ้าเกิดหลาย event ID ต่อ PaymentIntent เดียว ยังจับซ้ำที่ payment ID อีกชั้น
- Omise: ไม่สร้าง HMAC header ที่ Omise ไม่ได้ระบุใน protocol ใช้ event ID จาก delivery ไปเรียก Events API ด้วย merchant secret แล้วใช้ event ที่ตอบจาก API เป็นข้อมูลจริง เมื่อเป็น paid charge จะตรวจ Charges API เพิ่ม ก่อนนำไปลงเงิน ไม่ใช้จำนวนเงินที่แนบมากับ unsigned delivery
- 2C2P: รองรับ **PGW v4 backend payment response** แบบ `{payload: JWT}` ตรวจ HS256 ด้วย merchant secret และ merchantID ต้องตรง connection กำหนด merchant transaction timezone เป็น Asia/Bangkok ใช้ invoiceNo + tranRef + respCode เป็น identity; ตัด iat/exp/nbf/jti ออกจาก fingerprint เพื่อให้ token ที่ออกใหม่สำหรับผลเดิมไม่ทำให้ลงซ้ำ ไม่ใช้กับ PACO/JWE หรือ SoftPOS envelope ที่เป็นคนละ protocol
- Header `Idempotency-Key` ไม่บังคับต้องมี เพราะ Gateway ใช้ event identity ใน payload ได้ แต่ถ้าส่งมาต้องตรงกับ identity ที่ยืนยันแล้ว จึงไม่ใช้ header แปลกใหม่หลบ deduplication

Capture processor รองรับ Stripe payment_intent.succeeded, Omise charge.create/complete/capture ที่ paid และ 2C2P respCode 0000 รับเฉพาะ THB พร้อมตรวจยอดตรงกับ payment ที่บริษัทลงทะเบียนไว้ก่อนแล้ว ล็อก order เพื่อกัน payment คนละ ID เก็บเงินรวมเกินใบสั่งซื้อ

สำหรับ Omise ใช้ captured_amount เมื่อมี เพื่อไม่เอายอดที่ authorize สูงกว่ายอด capture มานับเป็นเงินรับ ถ้าออเดอร์ยังไม่ส่งมอบจะเครดิตบัญชีเงินรับล่วงหน้า; ถ้ารับรู้รายได้แล้วจะเครดิตลูกหนี้ การรับเงินไม่เปลี่ยน order เป็น RECOGNIZED และไม่เครดิตรายได้ซ้ำ

เงินที่ Gateway เก็บไว้ลงบัญชี clearing ประเภท OTHER_ASSET ยังไม่ใช่ยอดที่เข้าธนาคาร การกระทบยอดธนาคารและการ import ค่าธรรมเนียมจริงเป็นข้อมูลอีกชุดหนึ่ง ค่า fee ที่ยังไม่เข้าระบบไม่ถูกกล่าวอ้างว่าเป็นศูนย์ที่ยืนยันแล้ว

เหตุการณ์ refund/dispute/reverse/void ถูกส่งกลับ `RECONCILIATION_REQUIRED` เพื่อให้ตรวจสอบ ไม่ตอบสำเร็จแล้วทิ้งยอดปรับปรุง ขั้นตอนนี้มีข้อมูลเครดิตโน้ต/คืนเงินในตัวคำนวณ แต่ไม่ได้เพิ่มระบบออก refund หรือหน้ากระทบยอด เพราะผู้ใช้ขอเฉพาะ backend core

## สูตรกำไรต่อออเดอร์

`calculateActualProfit(companyId, orderId)` ต้องถูกเรียกใน scope ที่ผ่านการตรวจแล้ว เช่น route GET `/api/orders/:orderId/profit` ซึ่งต้องมี permission `finance.profit.read`

อ่านทุกแหล่งใน REPEATABLE READ transaction เดียว:

1. ต้องเป็น order RECOGNIZED และวันรับรู้ไม่อยู่ในอนาคต; ใช้ `recognized_at` เป็นเวลาขายตาม accrual ไม่ใช้วันสั่งหรือวันรับ Webhook
2. Query `product_costs` ด้วย cost version + product + company และ `valid_during @> recognized_at` ตรวจว่าตรงกับ snapshot ใน order_items ไม่ใช้ต้นทุนปัจจุบัน ถ้าไม่มี/ไม่ตรง ให้หยุดคำนวณ
3. ยอดขายก่อน VAT หักเครดิตโน้ตที่โพสต์แล้ว ต้นทุน snapshot หัก COGS ของสินค้าที่รับคืน ยอด credit quantity/เงิน/COGS รวมต้องไม่เกินต้นฉบับ
4. ตรวจยอดขายและ COGS เทียบ posted ledger รวม reversal chains หาก source กับ ledger ต่างกันตอบ 409 เพื่อให้ reconcile ไม่สร้างผลกำไรที่ดูถูกต้องจากข้อมูลไม่ครบ
5. หัก gateway fees ก่อน VAT ที่ลงบัญชีแล้ว และตรวจเทียบ fee ledger แยก ไม่หัก fee ซ้ำอีกครั้งในสูตร
6. ค่าแอดใช้ revision ล่าสุดของแต่ละ campaign/วัน สะสมตั้งแต่ต้นเดือนของออเดอร์จนถึงวันที่ประเมิน หรือสิ้นเดือนนั้นหากเป็นเดือนเก่า ปันส่วนให้ออเดอร์ที่รับรู้ในเดือนเดียวกันด้วยวันตัดยอดเดียวกัน การใช้ pool คนละวันตัดยอดต่อออเดอร์จะทำให้รวมค่าแอดซ้ำ จึงไม่ใช้วิธีนั้น
7. Fixed Costs ปันส่วนตามวันจริงในเดือน/ปี รองรับ leap year และวันเริ่มรวม/วันสิ้นสุดไม่รวม ค่าเฉลี่ยรายวันคำนวณด้วยผลต่างของยอดสะสมที่ปัดเศษ เพื่อให้เดือนเต็ม/ปีเต็มรวมกลับมาตรงต้นทุนเดิม จากนั้นแบ่งให้ออเดอร์ที่รับรู้ในวันนั้น
8. ค่าใช้จ่ายอื่นใช้ posted ledger กลุ่ม OTHER_EXPENSE ของวันเดียวกัน ไม่รวม FIXED_COST ซ้ำกับข้อมูลเงื่อนไข fixed_costs

สูตร:

```text
Net revenue ex VAT = sales ex VAT − posted credit notes ex VAT
Net COGS           = sale-time snapshot COGS − restored COGS
Gross profit       = net revenue − net COGS
Contribution       = gross profit − gateway fees ex VAT
Net profit         = contribution − allocated ads − allocated fixed costs
                     − allocated other expenses
```

`netProfit` เป็น alias ของ `netProfitBeforeIncomeTax` ไม่ใช่กำไรหลังภาษีเงินได้นิติบุคคล `netMarginPercent` เป็น null เมื่อรายได้สุทธิศูนย์ ค่าเงินใน JSON ทุก field เป็น decimal string ไม่มี JavaScript floating point คำนวณยอดเงิน

ผลลัพธ์มี `PROVISIONAL_ALLOCATION` เพราะ overhead เป็นการปันส่วนและยังไม่มีข้อมูลยืนยันการปิดยอดนำเข้าค่าแอดทั้งหมด มี warning เมื่อไม่มีข้อมูล fee/ads ไม่เปลี่ยนการขาดข้อมูลให้เป็น “ยืนยันศูนย์” รายงานนี้เป็นกำไรของออเดอร์ตลอดอายุจนถึง asOf รวมเครดิตโน้ตและ fee ที่ทราบล่าสุด ไม่ใช่งบกำไรขาดทุนตามช่วงบัญชีที่นำกำไรออเดอร์ทั้งหมดมาบวกได้โดยไม่ดูงวด

`cash.gatewayCollected/refunded/netGatewayCollected` แสดงเงินผ่าน Gateway แยกจากกำไร และระบุว่าไม่ใช่ Bank Cash Flow

ตัวอย่าง fixture ที่ทดสอบจริง: ขายก่อน VAT 1,000, VAT 70, COGS 400, fee 30, ค่าแอดปันส่วน 33.34, fixed cost 38.34, ค่าใช้จ่ายอื่น 5 → กำไรก่อนภาษี **493.32** บาท การรับเงิน 1,070 ภายหลังไม่เปลี่ยนกำไร เมื่อคืนครึ่งหนึ่งพร้อมเครดิตโน้ต กำไรเป็น **193.32** บาท ส่วนการคืนเงินจริง 535 กระทบยอดเงินรับสุทธิแยกต่างหาก

## Migration และการรัน

ฐานข้อมูลที่ผ่านขั้นตอนที่ 1 ให้ใช้ admin/migrator รันเฉพาะ:

```sh
psql -X -v ON_ERROR_STOP=1 -f database/migrations/0002_backend_core.sql
```

ฐานข้อมูลใหม่ให้รัน `database/schema.sql` ของขั้นตอนที่ 1 ก่อน แล้วตามด้วย 0002 ไม่รัน bootstrap ซ้ำในฐานข้อมูลเดิม ถ้ามี COMPLETED idempotency record เก่าจริง migration จะตรวจว่ามี cached response ที่กู้คืนได้; ห้ามแก้ผ่านโดยลบประวัติทางการเงิน

```sh
npm ci
npm run typecheck
npm run build
npm start
```

| Environment variable | ค่าจริงที่ deployment ต้องกำหนด |
|---|---|
| DATABASE_URL | PostgreSQL login สมาชิก cmo_runtime ที่ไม่ใช่ owner/admin |
| DATABASE_CA_FILE | CA certificate path หาก PostgreSQL ใช้ private CA; remote connection ตรวจ TLS เสมอ |
| JWT_ISSUER | Issuer ของ identity provider |
| JWT_AUDIENCE | Audience ของ API |
| JWT_JWKS_URL | HTTPS JWKS URL ที่ deployment เชื่อถือ |
| PORT | ค่าเริ่มต้น 3001 |
| HOST | ค่าเริ่มต้น 127.0.0.1; ตั้งค่าตาม reverse proxy/container |

Integration connection ใช้ `credentials_secret_ref` รูปแบบ `env:NAME` โดย NAME เป็น env variable ที่ secret manager inject ให้ process ค่าภายในเป็น JSON:

| Provider | Fields ที่ต้องมีใน secret JSON |
|---|---|
| STRIPE | apiKey, webhookSecret, livemode boolean |
| OMISE | secretKey, livemode boolean |
| 2C2P | merchantSecret, transactionTimezone="Asia/Bangkok" |

ไม่ได้สร้าง credential ปลอมใน runtime หรือใส่ secret ตัวอย่างที่ใช้งานจริงไม่ได้ในไฟล์ `.env` ต้อง provision companies/users/RBAC, integration connection, account mapping และ pre-registered payments ด้วยข้อมูลจริงจากระบบ order/payment initiation ที่จะเรียก core นี้ โดย mapping ต้องเป็น clearing OTHER_ASSET, receivable RECEIVABLE, advance OTHER_LIABILITY ที่ active

API ต้องอยู่หลัง HTTPS reverse proxy และจำกัดการเข้าถึง PostgreSQL จาก backend เท่านั้น Application จะ fail startup หาก DB role ไม่ปลอดภัยหรือ configuration ที่จำเป็นหายไป

## การทดสอบและขอบเขต

บนเครื่อง Windows นี้ติดตั้งตัวทดสอบ PostgreSQL ตาม lockfile ของขั้นตอนที่ 1 แล้ว:

```sh
npm ci --prefix database/tests
npm test
```

ใช้ PostgreSQL 18.4 จริงที่ loopback:55440, สร้าง cluster ใหม่ใต้ `.local/` ทุกครั้ง, รหัสผ่านสุ่ม, app login ไม่ใช่ superuser และหยุด server หลังทดสอบ ไม่มีข้อมูลบริษัทจริง การทดสอบ Gateway ใช้ signed fixture และ mocked Omise HTTP response; ไม่ได้ส่งธุรกรรมเงินจริงหรืออ้างว่าผ่าน live-provider acceptance

ตรวจครบ: tenant isolation พร้อมกัน 50 scopes, JWT/สมาชิก/RBAC, rollback, 409 ขณะทำงาน, exact cached response, semantic duplicate, COMMIT failure, abandoned claim, provider verification, decimal precision เกิน JavaScript safe integer, leap year, COGS snapshot, VAT, ads revision, allocation conservation, credit notes/refunds และ missing ledger

## เอกสารต้นทางที่ตรวจเทียบ

- [node-postgres: transactions บน client เดียว](https://node-postgres.com/features/transactions)
- [Stripe: raw body, signature และ duplicate events](https://docs.stripe.com/webhooks)
- [Omise: verification ของ Webhook](https://docs.opn.ooo/api-webhooks)
- [Omise: paid_at และ captured_amount](https://docs.omise.co/charges-api)
- [2C2P PGW: backend payment response](https://developer.2c2p.com/docs/api-payment-response-backend)
- [decimal.js arithmetic](https://mikemcl.github.io/decimal.js/)
