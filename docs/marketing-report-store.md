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
## Lazada: เตรียมรายงานเดือนปฏิทิน

ดาวน์โหลดจาก Seller Center ร้านเดียวกัน เดือนเดียวกันสามไฟล์: Storewide Overview, Sponsored Max → รายละเอียด → Campaign และ Promoted Product ต้องเลือกวันที่ 1 ถึงวันสุดท้ายของเดือนใหม่ในแต่ละแท็บ เพราะ Lazada ไม่คงตัวกรองข้ามแท็บ

```powershell
python scripts/prepare-lazada-ads.py --overview <overview.xlsx> --campaigns <campaign.xlsx> --products <products.xlsx> --output reports/lazada-ads-YYYY-MM.input.json
node scripts/publish-monthly-ads.mjs --platform Lazada --business Payi --file reports/lazada-ads-YYYY-MM.input.json
```

ตรวจ dry-run ก่อนเติม `--publish` เพื่อบันทึกลงที่เก็บส่วนตัวที่อนุมัติแล้ว หรือเปิด JSON ในหน้ารายงานเพื่อตรวจก่อนบันทึก ตัวแปลงไม่เขียนทับไฟล์หลักฐานเดิม ใช้ชื่อใหม่เมื่อรายงานมีการแก้ไข

รูปแบบที่ตรวจแล้ว: ประเทศ TH, Sponsored Max Product; ไฟล์ Campaign เป็นยอดประเภทโฆษณาและ Campaign ID เป็น N/A รายสินค้าใช้ Product ID จากคอลัมน์ Product Management ไม่ใช้หมายเลขสินค้าโปรโมตแทน โดยเก็บ Campaign ID/หมายเลขสินค้าโปรโมตแยกไว้ใน sources ยอดค่าแอดต้องตรงรายวันและรายเดือนกับภาพรวมร้านและรายแคมเปญ จึงบันทึกได้ หากมีชนิดรายงานใหม่จะปฏิเสธเพื่อให้ตรวจรูปแบบก่อน ไม่สรุปว่าครอบคลุมแอดทุกชนิดของทุกบัญชี

พบยอดออเดอร์ของภาพรวมกับ Sponsored Max ต่างกัน ยังไม่ยืนยันสาเหตุ เก็บตามต้นทางทั้งสองชุด ไม่รวมออเดอร์ข้ามชุด ไม่ปรับ VAT และไม่ส่งรายงานไปแทน marketing_inputs/Dashboard/CFO
