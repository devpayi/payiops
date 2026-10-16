# โครงสร้างรายงานโฆษณาและยอดขาย TikTok รายเดือน

สถานะ: แผนสำหรับตรวจทาน วันที่ 16 ตุลาคม 2569 ปรับหลังทบทวนรายละเอียดรอบสอง ยังไม่เปลี่ยนหน้าเว็บ API ชีต สิทธิ์ หรือข้อมูลจริง และยังไม่ commit/push ระยะย้ายฟอร์มบันทึกยังมีข้อออกแบบค้าง ห้ามถือว่า implementation-ready ทั้งแผน

## เป้าหมายและขอบเขต

บอสเลือกกันยายน 2569 แล้วเห็นค่าแอด Shopee/TikTok ในช่วง 1–30 กันยายนเดียวกัน กดดูรายละเอียดรายสินค้าโดยไม่เจอสี/ไซซ์แยกเป็นคนละสินค้า ส่วนยอดขาย TikTok จาก Live/Video/Affiliate อยู่ใน Dashboard ยอดขาย และแต่ละยอดบอกได้ว่ามาจากรายงานใด

รอบนี้จัดทำแผนและจุดตรวจเท่านั้น ไม่เชื่อม API แพลตฟอร์ม ไม่สร้างงานดาวน์โหลดอัตโนมัติ ไม่ย้ายหรือลบข้อมูลเก่า ไม่เปลี่ยน Dashboard/CFO และไม่เพิ่มระบบเงินรับจริง

## โครงสร้างหน้าที่เสนอ

```text
Dashboard สรุปยอดขาย (เมนูเดิม)
  ├─ หน้ายอดขายเดิม
  └─ ช่องทางขาย TikTok (แท็บย่อยใหม่)
      ├─ รูปแบบคอนเทนต์: Live / Video Clip / Product Card
      ├─ ที่มาของยอดขาย: Seller / Affiliate
      └─ ข้อมูลที่กรอกไว้เดิม: แสดงแหล่งที่มาและข้อจำกัดแยกไว้

วิเคราะห์โฆษณา (เปลี่ยนชื่อแสดงผลของ Ads & Channels เมื่อพร้อม)
  ├─ ภาพรวมรายเดือน
  ├─ รายแคมเปญ / กลุ่มโฆษณา
  ├─ รายสินค้า (รวมสี/ไซซ์)
  └─ แหล่งข้อมูล / ตรวจยอด / กรอกค่าเดิม

ตั้งราคาและกำไร (เมนูเดิมและสิทธิ์เดิม)
  └─ ในอนาคตใช้ค่าแอดรายเดือนเป็นข้อมูลอ้างอิงหลังจับคู่สินค้าสำเร็จ
```

เก็บ internal tab ID `AdsChannels` และลิงก์จาก Dashboard เดิมไว้ เปลี่ยนชื่อที่แสดงเท่านั้น ไม่เพิ่ม Sidebar ใหม่ ไม่เปิดแท็บแก้ไข TikTok ให้ผู้ใช้ที่เดิมไม่มีสิทธิ์ แม้หน้า Dashboard จะเข้าถึงได้กว้างกว่า

จุดติดตั้งแท็บ TikTok ต้องสำรวจ container ของ Dashboard สรุปยอดขายใน App.jsx ก่อน ไม่ถือว่า MonthlyDashboard.jsx เป็นหน้าครอบ Dashboard ทั้งหมดโดยอัตโนมัติ

## ข้อมูลเดิมที่ต้องรักษา

| ส่วน | ข้อมูล/พฤติกรรมปัจจุบัน | ข้อกำหนดการย้าย |
|---|---|---|
| `marketing_inputs` | month, business, platform, metric, value, updated_at | คง schema และความหมายย้อนหลัง |
| `metric=ads` | ค่าแอดที่ฟอร์มเดิมคูณ 1.07 ก่อนบันทึก | อ่านเหมือนเดิม ไม่แปลง VAT ย้อนหลัง |
| TikTok เดิม | tt_gmv, affiliate, live, vdo, other | ติดป้ายเป็นข้อมูลเดิม ห้ามตีความใหม่หรือคำนวณย้อนหลัง |
| Dashboard/CFO | อ่าน metric=ads จาก marketing_inputs | ไม่ให้รายงานนำเข้าเปลี่ยนตัวเลขโดยอัตโนมัติ |
| สูตรตั้งราคา | Shopee/TikTok และการบันทึกแผนส่วนตัว | แยกจากการย้ายเมนูและรายงานนี้ |

ข้อผิดพลาดที่ต้องกัน: POST ปัจจุบันแทนข้อมูลทั้งเดือน และ overwrite ทั้งแท็บ ถ้าแยกฟอร์มใหม่แล้วส่งเฉพาะ ads หรือเฉพาะ TikTok ด้วย endpoint เดิม จะทำให้อีกชุดหายได้ รวมถึงเสี่ยงเขียนทับกันเมื่อเปิดหลายหน้าหรือหลายบัญชี

## กติกาของรายงานใหม่

1. เดือนใช้ `YYYY-MM` + `dateFrom` วันที่ 1 + `dateTo` วันสุดท้ายของเดือน + timezone Asia/Bangkok ตรวจวันที่จากหัวรายงานจริง ไม่ใช้ชื่อไฟล์อย่างเดียวหรือวันเริ่มแคมเปญ
2. แยกช่วงวันที่ครบเดือน / ความครอบคลุมของร้าน-ประเภทโฆษณา / ความครบของข้อมูลออเดอร์ออกจากกัน หัวรายงานเขียนสิ้นเดือนไม่ได้พิสูจน์ว่าออเดอร์หรือทุกประเภทรายงานมาครบ เลือกเดือนปฏิทินก่อนหน้าเป็นค่าเริ่มต้นและแสดงสถานะตามหลักฐาน; ถ้าไม่มีไฟล์ให้ขึ้น “ยังไม่มีรายงานเดือนนี้” ไม่แสดงศูนย์
3. ค่าเงินจาก CSV เก็บข้อความและความละเอียดต้นฉบับ ใช้ THB, parse แบบ decimal โดยกำหนดกติกาการปัดอย่างชัดเจน สรุปแสดงสองตำแหน่งแต่ไม่ปัดระหว่างทางโดยอัตโนมัติถ้าต้นฉบับละเอียดกว่า ไม่บวก VAT อัตโนมัติ; taxBasis เริ่ม `unknown` จนยืนยันจากหลักฐาน ไม่ถือว่าไฟล์หรือช่องกรอกทุกแพลตฟอร์มมีฐานภาษีเดียวกัน
4. ยอดขายที่โฆษณาให้เครดิตใช้ชื่อ “ยอดขายตามรายงานโฆษณา” แยกจากยอดขายในออเดอร์ Ops; ห้ามบวกสองยอดเข้าด้วยกัน
5. ผลรวม overview ใช้แถว root ของรายงานภาพรวม: โฆษณาสินค้าเดี่ยว + ยอดกลุ่ม โดยไม่รวมสมาชิกซ้ำ ส่วนยอดรายสินค้าใช้โฆษณาสินค้าเดี่ยว + สมาชิกจากรายงานกลุ่ม ไม่เอาแถว root ของกลุ่มมารวมด้วย ไม่ถือว่าทุกไฟล์ครอบคลุมทั้งร้าน และไม่รวมไฟล์รายงานที่ครอบคลุมโฆษณาชุดเดียวกันซ้ำ สินค้าเดียวลงสองแคมเปญอาจมีค่าแอดจริงทั้งสองก้อน จึงห้าม deduplicate ด้วย product ID เพียงอย่างเดียว
6. ช่องทางขาย TikTok แยก `orderSource=affiliate|seller|unknown` กับ `contentType=live|video|product_card|unknown` และ `attributionBasis` (direct/indirect/total/unknown) ห้ามบวก marginal totals ข้ามแกน ไม่อนุมาน cross-tab จากยอดรวมสองชุด
7. “อื่น ๆ” จากฟอร์มเก่าคงเป็นค่าเก่า ไม่ย้ายสูตร `GMV - Affiliate - Live - Video` ไปใช้กับรายงานใหม่ ไม่ตั้งยอดติดลบเป็นศูนย์เพื่อซ่อนปัญหาการเทียบยอด
8. จับคู่ด้วย platform item ID + shop + business ไปยังกลุ่มสินค้าของ Ops ไม่ใช้ชื่อเหมือนกันอย่างเดียว สี/ไซซ์รวมเป็นสินค้าเดียวเฉพาะ mapping ที่ยืนยันแล้ว สินค้าไม่ตรงให้แสดง “ยังไม่จับคู่” ไม่ทิ้งแถวหรือปันส่วนให้เอง
9. ค่าธรรมเนียม/ต้นทุนแผนตั้งราคามีผลตามสมมติฐาน ไม่ใช้แผนปัจจุบันอ้างเป็นกำไรจริงย้อนหลัง หากยังไม่มีต้นทุนช่วงนั้นให้แสดง “ยังประเมินไม่ได้”
10. ยอดกรอกเป็น `0` เป็นค่าที่ระบุชัด ไม่ใช่เหตุให้ fallback ไปออเดอร์ ค่าว่าง/ไม่มีข้อมูล/ไม่เกี่ยวข้อง/ค่าผิดรูปแบบต้องแยกสถานะ ไม่ใช้ `|| 0` ลบความแตกต่าง
11. เทียบ MoM กับเดือนปฏิทินก่อนหน้าจริง ถ้าเดือนก่อนขาดให้แสดง “ไม่มีข้อมูลเดือนก่อน” ไม่เทียบกับแถวก่อนหน้าที่บังเอิญเป็นสองเดือนก่อน และไม่ตี missing เป็นยอดตก 100%
12. ค่าแอดต่อชิ้น/สัดส่วนต่อยอดขายใช้ scope เดือน ร้าน แพลตฟอร์ม สินค้า และความครอบคลุมเดียวกัน ระบุฐานยอดขายและกติกาตัดยกเลิก/คืน แยก “ต่อชิ้นขายทั้งหมดของ Ops” จาก “ต่อชิ้นที่โฆษณาให้เครดิต” ตัวหารศูนย์หรือข้อมูลขาดแสดงคำนวณไม่ได้ ไม่แสดง Infinity/0 หลอก
13. ROAS รวมคำนวณจากยอดขายที่ให้เครดิตรวม ÷ ค่าแอดรวมเฉพาะฐานที่เข้ากัน ไม่เฉลี่ย ROAS ของแถวหรือแพลตฟอร์มตรง ๆ และไม่เรียกยอดขายทั้งหมด ÷ ค่าแอด ว่า ROI กำไร ต้องระบุชื่อสูตร

## สัญญาข้อมูลสำหรับขั้นพัฒนา (ยังไม่สร้างชีต)

เก็บรายงานแยกจาก `marketing_inputs` เป็นชุดนำเข้าอ้างอิง source batch เพื่อให้ย้อนกลับได้ทั้งชุด:

```text
ReportBatch
  id, schemaVersion, platform, shopId, business, reportKind
  month, dateFrom, dateTo, timezone, currency, taxBasis
  sourceFilename, sourceSha256, exportedAt, importedAt, importedBy
  status: staged | validated | published | superseded | rejected
  supersedesBatchId, rowCount, controlTotals, validationIssues
  amountPrecision, roundingPolicy
  coverage: dateRange, accountSet, adTypes, metricCoverage, ordersCoverage
  attribution: window, clickViewBasis, eventDateBasis, definitionVersion, status

PublishedReportSet
  id, platform, shopId, business, month, reportKinds
  overviewBatchId?, groupDetailBatchId?, otherBatchIds
  reconciliationResults, coverageStatus, status, supersedesSetId

AdReportRow
  batchId, sourceRow, grain: campaign | group | product
  platformCampaignId?, platformGroupId?, parentSourceRow?, platformItemId?
  campaignName?, productName?, spendSatang?, attributedSalesSatang?
  attributedOrders?, attributedUnits?, sourceRoas?, productFamilyKey?
  metricStates: present | absent | invalid | not_applicable (แยกราย metric)
  productMappingVersion?, mappedAt?, mappingStatus
  rawHeaders, rawRowValues

TikTokSalesRow
  batchId, sourceRow, orderSource?, contentType?, attributionBasis
  metricDefinition, gmvSatang?, orders?, units?, metricStates
```

เครื่องหมาย ? หมายถึงไม่ทราบได้จริง ห้ามแทน ID ที่หายด้วยชื่อโฆษณาแล้วอ้างว่าเป็น ID ถ้าแหล่งข้อมูลไม่มี group ID ใช้ขอบเขตแถวต้นฉบับภายใน batch และติดข้อจำกัดไว้

ไฟล์เดิม SHA256 เดิมภายในร้าน/ประเภทรายงานเดียวกันต้องไม่ถูกนับซ้ำ ไฟล์เดือนเดิมที่ส่งออกใหม่ให้เป็น revision ใหม่ มี preview เปรียบเทียบและเลือกใช้อย่างชัดเจน ไม่รวมสอง revision เข้าด้วยกัน ไม่ publish ชุดที่ upload ไม่ครบหรือมี validation error

หน้า overview และ drill-down ต้องอ้าง PublishedReportSet เดียวกันซึ่งตรึง batch IDs ไม่เปิดใช้ไฟล์ภาพรวม revision ใหม่กับรายละเอียด revision เก่าโดยเงียบ ตรวจ export time, definition และผลต่างก่อน publish ถ้าเข้ากันไม่ได้แสดงแยกเป็น “ยังไม่กระทบยอด” และย้อนกลับ report set ทั้งชุดได้ ไม่บังคับให้ไฟล์ที่ export คนละเวลาต้องตรงกันโดยตัดเศษหรือปรับค่าเอง การปัดเศษยอมรับได้เฉพาะเกณฑ์ที่มีเหตุผลจากความละเอียด/จำนวนแถวและยังแสดงผลต่างจริง

การเปลี่ยน mapping หรือสมาชิกกลุ่มสินค้าต้องมี version ถ้าต้องจัดกลุ่มรายงานย้อนหลังใหม่ให้เป็นการ restate ที่ตรวจผลก่อน ไม่เปลี่ยนตัวเลขย้อนหลังเพราะทะเบียนวันนี้เปลี่ยนชื่อหรือกลุ่ม

ใช้ endpoint `/api/marketing` เดิมเป็น dispatcher ได้เพื่อลดผลต่อจำนวน serverless functions แต่แยก handler/สัญญา read-only ของรายงานใหม่จาก `kind=inputs` ไม่ให้ GET สร้างหรือย้ายข้อมูลใหม่

## ขอบเขตบันทึกก่อนแยกฟอร์ม

เฟสแรกหน้ารายงานและแท็บ TikTok ใหม่อ่านอย่างเดียว ฟอร์มเดิมยังเป็นผู้บันทึกเพียงจุดเดียวผ่านพฤติกรรมเดิม ไม่เปิดสองฟอร์มที่ POST ทั้งเดือนพร้อมกัน

ก่อนเปิดแก้ไขแยกหน้า ต้องออกแบบ writer ใหม่ให้จำกัด domain `ads` หรือ `tiktok-sales` + month + business + platform, ตรวจ allowlist ของ metric, แยกค่าว่าง/ศูนย์/ลบอย่างชัดเจน และมี requestId, baseRevision, audit actor, ผล unknown/recover หลัง timeout

ห้ามแก้แบบอ่านทั้งชีตแล้ว merge ใน browser ก่อนส่งกลับ หรือใช้ mutex ใน process เป็นคำตอบสำหรับ serverless concurrency ต้องพิสูจน์การบันทึกพร้อมกันว่าไม่ทำลายข้อมูลนอก scope และไม่ยอมรับ stale overwrite

ขอบเขตบันทึกยังออกแบบไม่จบ: append revision อย่างเดียวตรวจพบการเขียนชนกันได้ แต่ไม่ได้รับประกันผู้ชนะหรือ commit สำเร็จแบบ atomic จึงยังไม่เลือกเป็น canonical manual writer และห้ามตอบ “บันทึกสำเร็จ” ทั้งสองคำขอแล้วค่อยเปลี่ยนฐานย้อนหลังเมื่อพบ fork

ก่อนระยะ 5 ต้องกำหนด canonical manual store, atomic/serialized commit, recovery, compatibility reader และ retirement ของ old-client POST ให้ครบเส้นทาง รายชื่อ readers ต้องรวม App.useRoiStats, MonthlyDashboard, AdsChannels และ CFO ซึ่งอ่าน marketing_inputs ตรงอยู่ ถ้าใช้ store ใหม่ readers ต้องใช้ adapter ที่ได้ค่าและ shape เดิมจาก commit ที่ยืนยันแล้ว การ copy projection กลับ marketing_inputs ด้วย clear/rewrite ไม่แก้ความเสี่ยงเดิม

ช่วงเปลี่ยน writer ต้องปฏิเสธ client เก่าที่ส่ง full-month POST ด้วยรหัส conflict/upgrade และยังคงข้อมูลที่กรอกไว้ให้คัดลอกได้ หยุด legacy writer ก่อน cutover ไม่ปล่อยสองแหล่งเขียนพร้อมกัน รายละเอียดนี้เป็น gate ของระยะ 5 ซึ่งทำแยกจากหน้ารายงานอ่านอย่างเดียว

กรณีไฟล์รายเดือนมีเพียงผลรวม ห้ามแสดงกราฟรายวันจากการหารเฉลี่ยหรือถือว่าไฟล์มี daily detail

ตราบใดที่ writer ใหม่ยังไม่ผ่าน ห้ามถอนฟอร์มเดิม ห้ามเปิด scoped editing และห้ามเปลี่ยน consumer ของ marketing_inputs

## ภาพการใช้งานและเงื่อนไขจบงาน

- บอสเลือก “ก.ย. 2569 / Payi / Shopee” แล้วเห็นช่วง 1–30 ก.ย. และยอดตามรายงาน โดยไฟล์ภาพรวมที่ตรวจแล้วมียอดค่าแอด 968,543.27 บาท ไม่ปนไฟล์ย้อนหลัง 16 ก.ย.–16 ต.ค.
- กดรายสินค้าแล้วจำนวนรวมสมาชิกไม่ซ้ำกับยอดกลุ่ม และเห็นรายการยังไม่จับคู่ พร้อมผลต่างจากยอดควบคุม ไม่มีผลต่างที่ถูกซ่อน
- TikTok ที่ยังไม่มีรายงานขึ้น “รอรายงาน TikTok เดือนกันยายน” ไม่เติม 0 หรือจำลองข้อมูลให้ดูเหมือนจริง
- เปิดช่องทางขาย TikTok เห็นสองมุม Seller/Affiliate กับ Live/Video/Product Card; ข้อมูลเก่ามีป้าย “ข้อมูลที่กรอกไว้เดิม — ยังไม่ยืนยันนิยาม”
- ไฟล์ผิดเดือน ผิดร้าน สกุลเงินผิด หรือไม่มีคอลัมน์จำเป็น แจ้งสาเหตุและไม่ publish; สลับเดือนแล้วข้อมูลคนละเดือนไม่ค้าง; โหลดล้มเหลวยังบอกแหล่งและเวลาของข้อมูลล่าสุดที่แสดงได้
- กรอกแล้วสลับเดือน/หน้า มีตัวบอกว่ายังไม่บันทึก ไม่เขียนค่าเดิมของอีกเดือนโดยเงียบ; บันทึกสำเร็จต้อง invalidate ผู้อ่านที่ mount ค้างอยู่ด้วย
- สิทธิ์ API และ UI ต้องตรงกัน การย้ายเข้า Dashboard ไม่ขยายสิทธิ์เข้าถึงค่าแอด/แก้ยอด TikTok/ต้นทุนกำไร

## ลำดับการเปลี่ยนและประตูตรวจ

| ระยะ | สิ่งที่ทำ | หลักฐานก่อนขยับต่อ |
|---|---|---|
| 0 — รอบนี้ | แผน dependency และ independent review | ระบุจุดเขียนทับ VAT แกน TikTok สิทธิ์ และ rollback |
| 1 — baseline | เก็บ snapshot ที่ได้รับอนุญาตและชุดตัวอย่างทดสอบนอก Git; เก็บ expected Dashboard/CFO ค่าเดิม | เทียบยอดรายเดือน/ธุรกิจ/แพลตฟอร์มและ role matrix; ไม่แก้ข้อมูลจริง |
| 2 — อ่านอย่างเดียว | แยก selectors/presentational components ของช่องทางขายและรายงาน; ใช้ flag ปิดไว้เป็นค่าเริ่มต้น | หน้าเดิมและสูตรเดิมเหมือนเดิม; ไม่เพิ่ม mutation/import/สร้างชีตจากการอ่าน; audit legacy GET ที่ยังเรียก ensureSheet; ไม่มีการขยายสิทธิ์ |
| 3 — รายงานตัวอย่าง | parser/validator/reconciliation ของ Shopee กันยายน; staging preview เฉพาะ dev/boss | ค่าแอดตรง source control; group/member ไม่ซ้ำ; duplicate/revised file/unknown mapping/month boundaries ผ่าน |
| 4 — ย้ายตำแหน่ง | เปิดแท็บช่องทางขายอ่านอย่างเดียว; เปลี่ยนชื่อแสดงผล AdsChannels เมื่อผู้ใช้ดูแล้ว | UI walkthrough แสดงเดือนถูก แหล่งถูก ข้อมูลเก่ายังอยู่; ลิงก์เดิมกลับถูกหน้า |
| 5 — แยกบันทึก (ยังติดข้อออกแบบ) | canonical writer+reader adapter+old client retirement+recovery ก่อนย้ายฟอร์ม | atomic commit, concurrency, stale revision, timeout/retry, zero/clear, role tests; save ฝั่งหนึ่งไม่เปลี่ยนอีกฝั่ง; ไม่มี clear/rewrite projection |
| 6 — ใช้ยอดใหม่กับระบบเดิม | เสนอ reconciliation ก่อนเลือกแหล่ง official ต่อเดือน/ร้าน/แพลตฟอร์ม | ระบุ VAT/basis/source ที่ตกลงแล้ว; compare before/after; เปิดแยกจาก UI migration |

ระยะ 1 เป็นต้นไปยังไม่ดำเนินการในรอบนี้ ไม่ใช้คำว่า “พร้อมใช้งาน” จากการ build ผ่านเพียงอย่างเดียว ต้องเดินหน้าเว็บจริงในเส้นทางของบอสและตรวจ API ด้วย

## Rollback

ปิด feature flags กลับ UI เดิมได้โดยไม่ต้องกู้ชีต เพราะระยะอ่านอย่างเดียวไม่ย้ายข้อมูล เก็บ internal tab IDs และ contract ของ marketing_inputs เดิมไว้ หากเปิดรายงานใหม่แล้วต้องถอย ให้ย้อน active batch/revision โดยมีประวัติ ไม่ลบ raw CSV หรือเขียนทับยอดเก่า การเปิด writer ใหม่ต้องไม่มี legacy writer ที่ยัง rewrite ทั้งชีตมาชนกัน

หากจำเป็นต้อง restore ข้อมูลจริง ต้องหยุด writer ก่อน ตรวจ revision/รายการบันทึกหลัง snapshot และยืนยันว่าไม่ทำลายงานที่บันทึกภายหลัง ห้ามใช้ snapshot เก่าเขียนทับระหว่างยังเปิดรับการบันทึก

## ข้อที่ยังต้องตรวจจากบัญชีจริง

- TikTok หลังล็อกอิน: export มี dimension และ direct/indirect อย่างไร ช่วงเดือนครบหรือไม่ และครอบคลุมร้านไหน
- source CSV และเอกสารประกอบระบุฐาน VAT ของแต่ละร้าน/แพลตฟอร์มว่าอย่างไร; ไม่ตัดสินจากสูตรเดิม
- การจับคู่ item ID → กลุ่มสินค้า และชื่อแคมเปญซ้ำ/เปลี่ยนชื่อ มีข้อมูลที่ใช้ยืนยันเพียงพอหรือไม่
- writer/storage concurrency prototype ต้องผ่านก่อนเลือกเปิดเส้นทางบันทึก ไม่มีเหตุให้เปลี่ยนโครงสร้างฐานข้อมูลทั้งระบบในรอบย้ายหน้า
- api/monthly.js ตัด cancel+return แต่ api/_lib/cfo.js ตัด cancel อย่างเดียว และชุดตั้งราคามีกติกาอีกชุด ดังนั้นระบุ definition ของยอดแต่ละชุดและทำผลเทียบก่อนเชื่อม ห้ามแก้กติกายอดเก่าพร้อมการย้ายหน้าครั้งนี้

## สถานะนำไปทำ — 16 ต.ค. 2569 รอบนำเข้า Payi Ops

ทำโครงสร้างเมนูและหน้าอ่านรายเดือนในแอปจริงที่รันในเครื่องแล้ว ดู [ความคืบหน้าล่าสุด](marketing-monthly-progress.th.md) เมนูวิเคราะห์โฆษณาเก็บฟอร์มกรอกเดิมไว้แยกแท็บ และเพิ่มช่องทางขาย TikTok ใต้ Dashboard โดยยังไม่แยก writer หรือเปลี่ยนฐานค่า Ads ของ Dashboard/CFO

รายงานจริงถูกเก็บแบบ private local revisions นอก Git เพื่อให้ตรวจหน้าได้ก่อน ไม่มี production report store, publish, commit หรือ push ในรอบนี้ Gate ของ writer ในแผนยังมีผล

## หลักฐานและแหล่งอ้างอิง

- api/_lib/marketingInputs.js:44–62 — replace ทั้งเดือนและ overwrite ทั้งแท็บ
- src/pages/AdsChannels.jsx:80–100,139–147,183–204 — VAT กลับไปมา, GMV basis, other, payload รวมสอง domain
- src/App.jsx:262–301,1451–1473 — Dashboard reader และแท็บที่ mount ค้าง
- src/pages/MonthlyDashboard.jsx:146–165 — สิทธิ์และการอ่านค่าแอด
- api/_lib/cfo.js:22–33 — CFO อ่านค่าแอดชุดเดียวกัน
- shared/roles.js และ api/_lib/auth.js:75 — สิทธิ์ Dashboard ไม่เท่ากับสิทธิ์ marketing writer
- CSV ที่ดาวน์โหลด 16 ต.ค. 2569: ข้อมูล-Shopee-Ads-01_09_2026-30_09_2026.csv และ Shopee-Ads-ข้อมูล-กลุ่ม-โฆษณา-01_09_2026-30_09_2026.csv ใน Downloads (ไฟล์จริงไม่ใส่ Git)
- TikTok Thailand, GMV refinement, เผยแพร่ 28 พ.ค. 2026, ตรวจ 16 ต.ค. 2026: https://seller-th.tiktok.com/university/essay?knowledge_id=4862402286487297 — order source/content type เป็นคนละแกนและมี direct/indirect; จึงใช้ข้อสรุปเรื่องการแยกมุมดู ไม่อนุมานยอดในบัญชีที่ยังเข้าไม่ได้
- React, Sharing State Between Components / Preserving and Resetting State, ตรวจ 16 ต.ค. 2026: https://react.dev/learn/sharing-state-between-components และ https://react.dev/learn/preserving-and-resetting-state — ใช้ state เจ้าของเดียวและกำหนดพฤติกรรมคง/รีเซ็ตฟอร์มอย่างชัดเจน ไม่เพิ่ม state library เพื่อย้ายสองฟอร์ม
