# Private monthly ad report storage

The report journal is independent of `marketing_inputs`. Saving a report never
changes Dashboard/CFO values or pricing calculations. Dev/Boss authentication is
required for the save API; the server rebuilds totals from submitted source files.

## Provisioning

1. Create a private spreadsheet with a `report_revisions` tab and the exact
   `REPORT_HEADERS` from `api/_lib/marketingReportRevisions.js` in A1:I1.
2. Obtain explicit approval before granting the application service account
   Writer access. Do not share publicly or grant access to other operational sheets.
3. Set `MARKETING_REPORTS_SHEET_ID` to that spreadsheet ID and
   `MARKETING_REPORTS_STORE_APPROVED=true` in the server environment. Keep credentials
   server-only. Existing operational, archive, HR and pricing sheet IDs are rejected.
4. Run source imports without `--publish` first; then publish only reviewed files.
   Read the stored reports back and compare month, shop, spend and source fingerprints
   before enabling/deploying the report UI.

```powershell
node scripts/publish-monthly-ads.mjs --platform Shopee --business Payi --file '<overview.csv>' --file '<group-detail.csv>'
node scripts/publish-monthly-ads.mjs --platform 'TikTok Shop' --business Payi --file '<dashboard-capture.json>'
```

Add `--publish` only after store approval and dry-run verification. TikTok JSON
is a recorded dashboard capture, not a platform-exported product report. Lazada
accepts a JSON bundle prepared from the three verified export formats described below.

## Revisions and failures

### Product mappings

`/api/marketing?kind=ad-product-mappings` is Dev/Boss only. GET reads mappings and the existing Ops product-family catalog, returning family names and keys without SKU-level options. POST validates each source against stored reports and its target against the same business's catalog.

Mappings live in the separate `ad_product_mappings` tab of the approved private report spreadsheet, never in `product_aliases`, inventory, raw orders or `marketing_inputs`. The source identity is `[platform,business,shopId,itemId]`, with no month so mappings carry forward. Unmapped, deleted-target and cross-business records stay separate; similar names never merge automatically.

Each save is one append-only batch of up to 50 changes in one literal JSON cell with SHA256. Every item carries its opened revision. The reader applies a batch only if all expected revisions match the current accepted state, so the first valid concurrent batch wins without partially applying a conflicting batch. Retry IDs are idempotent; unmapping keeps a tombstone revision and can be reversed by mapping again. POST reads back the accepted batch before reporting success. Failed or unconfirmed saves require a refresh before retrying.

GET never creates the tab; it can be provisioned once or initialized by the first authorized POST. No new environment variable or public permission is needed. Costs stay unchanged by mapping. Product totals combine spend and shares; attributed sales and ROAS remain per platform to avoid treating potentially overlapping credits as unique revenue.

Each import appends source text, hashes, normalized results and a commit marker in
one atomic Sheets batch. Literal string cells prevent formula execution. Revisions
remain in the journal; the reader selects the latest revision per platform,
business, shop and calendar month. A → B → A does not double-count totals.

If a request times out, refresh before trying again: the batch may have committed.
Malformed headers, incomplete revisions and modified hashes fail closed. Access
failures show an error; production never silently falls back to local private files.
Do not manually edit journal rows. Use a new verified import to correct a report.

Disabling the approved-store flag hides report availability and retains the legacy
manual ad-cost form. Source files and report JSON belong in ignored `reports/`
or private storage, never Git, `public/`, or a client bundle.
## ข้อมูลและประวัติในหน้าเว็บ

ก่อนบันทึก หน้าเว็บส่งไฟล์ให้เซิร์ฟเวอร์อ่านใหม่ผ่าน `POST kind=review-report` แล้วแสดงค่าแอด ยอดขาย ออเดอร์ จำนวนสินค้า และค่าแอดที่ระบุสินค้าได้ เทียบชุดที่ใช้อยู่กับชุดใหม่ หาก Product ID เดิมหายหรือความครบของรายละเอียดลดลง ต้องยืนยันคำเตือนก่อนแทนทั้งชุด ไฟล์ที่เหมือนชุดที่ใช้อยู่ไม่บันทึกเพิ่ม

ในข้อมูลและประวัติ ปุ่ม “ยกเลิกการใช้งาน” เอาชุดนั้นออกจากการคำนวณโดยไม่ลบหลักฐาน คืนได้ด้วย “คืนชุดที่ยกเลิก” หรือเลือก “คืนกลับมาใช้” จากชุดเก่า มีหน้าตรวจเทียบและยืนยันก่อนเปลี่ยนทุกครั้ง

การเปลี่ยนใหม่ใช้ record version 2 พร้อม request ID, expected event ID และ hash ของชุดที่ตรวจแล้ว การ replay journal รับเฉพาะคำขอที่ตรงกับ head ณ ลำดับ append จึงกัน stale write และ concurrent write ได้ รวม cancelled head เพื่อกัน ABA การ retry request ID เดิมไม่เพิ่มการเปลี่ยนซ้ำ คำขอที่ append แล้วแต่ชนกับ head ใหม่ปรากฏเป็น conflict และไม่ใช้คำนวณ API อ่านกลับเพื่อยืนยันผลก่อนตอบสำเร็จ

Restore/cancel เก็บ reference ถึง event ต้นฉบับ ไม่คัดลอกไฟล์ Excel ทั้งชุดซ้ำ ประวัติ version 1 ยังอ่านได้ แต่ legacy writer ไม่สามารถทับ scope หลังมี guarded write แล้ว สคริปต์ publish ใช้ expected-head เช่นเดียวกัน หน้าเว็บเก่าที่ไม่มี review token ต้องรีเฟรชก่อนบันทึก

หน้า วิเคราะห์โฆษณา → ข้อมูลและประวัติ แสดงชุดล่าสุดที่บันทึกแล้วแยกตามธุรกิจ แพลตฟอร์ม ร้าน และเดือน พร้อมช่วงวันที่ ชื่อไฟล์ ผู้บันทึก และเวลาไทย กรองดูทุกเดือนที่มีข้อมูลได้ ไฟล์ที่เปิดดูชั่วคราวไม่นับเป็นข้อมูลที่บันทึก

ประวัติอ่าน commit ที่ตรวจ hash และโครงสร้างครบจาก `report_revisions` รวมชุดเก่าที่ถูกแทนที่แล้ว มีเพียง commit ล่าสุดต่อ scope ที่ขึ้นว่าใช้งานอยู่ แม้บันทึก A → B → A หรือส่งชุดเดิมซ้ำก็ไม่นับยอดเพิ่ม เวลาและผู้บันทึกใช้ค่าที่เก็บไว้จริง ไม่สร้างย้อนหลังให้ข้อมูลที่ไม่มีค่า

`GET /api/marketing?kind=report-history` ใช้สิทธิ์เดียวกับรายงานรายเดือน คืนเฉพาะ metadata และชื่อไฟล์ ไม่ส่งเนื้อหาไฟล์ต้นฉบับหรือ base64 ออกมา ไม่บันทึกเหตุการณ์เปิด preview หรือความพยายามที่ล้มเหลว

## Lazada: เตรียมรายงานเดือนปฏิทิน

ดาวน์โหลดจาก Seller Center ร้านเดียวกัน เดือนเดียวกันสามไฟล์: Storewide Overview, Sponsored Max → รายละเอียด → Campaign และ Promoted Product ต้องเลือกวันที่ 1 ถึงวันสุดท้ายของเดือนใหม่ในแต่ละแท็บ เพราะ Lazada ไม่คงตัวกรองข้ามแท็บ

```powershell
python scripts/prepare-lazada-ads.py --overview <overview.xlsx> --campaigns <campaign.xlsx> --products <products.xlsx> --output reports/lazada-ads-YYYY-MM.input.json
node scripts/publish-monthly-ads.mjs --platform Lazada --business Payi --file reports/lazada-ads-YYYY-MM.input.json
```

ตรวจ dry-run ก่อนเติม `--publish` เพื่อบันทึกลงที่เก็บส่วนตัวที่อนุมัติแล้ว หรือเปิด JSON ในหน้ารายงานเพื่อตรวจก่อนบันทึก ตัวแปลงไม่เขียนทับไฟล์หลักฐานเดิม ใช้ชื่อใหม่เมื่อรายงานมีการแก้ไข

รูปแบบที่ตรวจแล้ว: ประเทศ TH, Sponsored Max Product; ไฟล์ Campaign เป็นยอดประเภทโฆษณาและ Campaign ID เป็น N/A รายสินค้าใช้ Product ID จากคอลัมน์ Product Management ไม่ใช้หมายเลขสินค้าโปรโมตแทน โดยเก็บ Campaign ID/หมายเลขสินค้าโปรโมตแยกไว้ใน sources ยอดค่าแอดต้องตรงรายวันและรายเดือนกับภาพรวมร้านและรายแคมเปญ จึงบันทึกได้ หากมีชนิดรายงานใหม่จะปฏิเสธเพื่อให้ตรวจรูปแบบก่อน ไม่สรุปว่าครอบคลุมแอดทุกชนิดของทุกบัญชี

พบยอดออเดอร์ของภาพรวมกับ Sponsored Max ต่างกัน ยังไม่ยืนยันสาเหตุ เก็บตามต้นทางทั้งสองชุด ไม่รวมออเดอร์ข้ามชุด ไม่ปรับ VAT และไม่ส่งรายงานไปแทน marketing_inputs/Dashboard/CFO
