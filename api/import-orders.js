// /api/import-orders
//   GET    ?view=log             → ประวัติการนำเข้าจาก import_log
//   POST   { fileName, platform, business, rows } → นำเข้าออเดอร์เข้า raw_orders_YYYY_MM
//   DELETE ?importId=IMPxxxx      → ลบล็อตไฟล์นี้ออกจาก raw_orders_* ทุก tab ที่เกี่ยวข้อง
import { requireDev } from './_lib/auth.js'
import { getSheet, appendRows, batchGetValues, overwriteSheet, getMeta } from './_lib/sheets.js'
import { isoDate } from './_lib/dates.js'
import ZIP_TO_PROVINCE from './_lib/zipToProvince.js'

const normalize = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
// Sheets (USER_ENTERED) auto-converts numeric-looking strings to real numbers — not just
// plain digit strings (which then risk float64 precision loss past ~16 digits) but also
// alphanumeric IDs that happen to parse as scientific notation, e.g. Shopee order id
// "26060480584E43" reads as 2.6060480584e43. Since these fields are pure identifiers,
// never used arithmetically, always force text — a leading "'" matches how typing '123
// into the Sheets UI keeps it literal, and is a no-op for values already non-numeric.
const forceText = (v) => { const s = String(v ?? ''); return s ? `'${s}` : s }

// province ต่อท้าย (2026-08) — เพื่อทำ demographic ตามพื้นที่ (payi-insights) แถวเก่าก่อนหน้านี้จะว่างช่องนี้
// (ไม่ backfill ย้อนหลัง ตามกฎ append-only เดียวกับ claims id/source_file)
// shipping_option / fulfillment_type ต่อท้าย (2026-09) — วิเคราะห์ % ส่งด่วน/ส่งทันที และประเมิน
// ความคุ้มของ fulfillment (append-only เดียวกับ province — แถวเก่าก่อนหน้านี้จะว่าง 2 ช่องนี้ ไม่ backfill)
const RAW_HEADERS = ['order_key', 'order_id', 'order_item_id', 'date', 'platform', 'business', 'sku_platform', 'product_name', 'variation_name', 'master_sku', 'display_name', 'qty', 'revenue', 'order_status', 'imported_at', 'source_file', 'import_id', 'alias_key', 'province', 'shipping_option', 'fulfillment_type']

function pick(row, keys) {
  const entries = Object.entries(row)
  // pass 1: exact header match (avoids grabbing an unrelated column that merely
  // contains a candidate word as a substring, e.g. "สถานะการคืนเงินหรือคืนสินค้า"
  // matching the "สินค้า" candidate before the real "ชื่อสินค้า" column is checked)
  for (const [k, v] of entries) {
    const nk = normalize(k)
    if (keys.some((c) => nk === normalize(c))) return v
  }
  // pass 2: substring fallback for loosely-named columns
  for (const [k, v] of entries) {
    const nk = normalize(k)
    if (keys.some((c) => nk.includes(normalize(c)))) return v
  }
  return ''
}

// เดาแพลตฟอร์มจาก "รูปร่างคอลัมน์" ของไฟล์ export แต่ละแพลตฟอร์ม (เชื่อถือได้กว่าหาคำว่า
// "tiktok"/"shopee" ในเนื้อหา — ไฟล์ TikTok Shop จริงไม่มีคำว่า "tiktok" อยู่ในหัวคอลัมน์เลย
// เคยทำให้เดาผิดเป็น Shopee เงียบๆ มาแล้ว) คืน null ถ้าเดาไม่ได้ ไม่ default เดาผิดแบบเงียบๆ อีก
function detectPlatform(row) {
  const keys = new Set(Object.keys(row).map(normalize))
  const hasAny = (...cands) => cands.some((c) => keys.has(normalize(c)))
  if (hasAny('order substatus', 'rts time', 'sku id', 'warehouse name', 'creator handle')) return 'TikTok Shop'
  if (hasAny('orderNumber', 'createTime', 'sellerSku', 'lazadaSku', 'orderItemId')) return 'Lazada'
  if (hasAny('เลขที่คำสั่งซื้อ', 'หมายเลขคำสั่งซื้อ', 'เลขอ้างอิง sku (sku reference no.)')) return 'Shopee'
  // last resort: literal brand-name text anywhere in headers/values
  const blob = normalize(Object.keys(row).join(' ') + ' ' + Object.values(row).join(' '))
  if (blob.includes('tiktok')) return 'TikTok Shop'
  if (blob.includes('lazada')) return 'Lazada'
  if (blob.includes('shopee')) return 'Shopee'
  return null
}

function genImportId() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0')
  return `IMP${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
}

export default async function handler(req, res) {
  if (!requireDev(req, res)) return
  try {
    if (req.method === 'GET' && (req.query.view || 'log') === 'log') {
      let imports = []
      try {
        const log = await getSheet('import_log')
        // เดิมจำกัดแค่ 15 แถวล่าสุด — ไม่พอเวลาต้องหาแบตช์เดือนก่อนๆ มาลบแล้วอัพใหม่ (owner ขอ 2026-08-01)
        // import_log เป็น log ต่อครั้งที่กดอัพโหลด ไม่ใช่ต่อออเดอร์ ทั้งปีก็ไม่กี่ร้อยแถว โชว์ทั้งหมดได้สบาย
        imports = log.filter((r) => r.status === 'active' || !r.status).reverse().map((r) => ({
          importId: r.import_id, file: r.filename, business: r.business, platform: r.platform, rows: Number(r.rows_imported) || 0, at: r.uploaded_at,
        }))
      } catch { /* no import_log tab */ }
      return res.status(200).json({ success: true, imports })
    }

    if (req.method === 'DELETE') {
      const importId = String(req.query.importId || '')
      if (!importId) return res.status(400).json({ success: false, error: 'ต้องระบุ importId' })

      const logVr = await batchGetValues(['import_log!A:Z'])
      const logValues = logVr[0]?.values || []
      const logHeaders = logValues[0] || []
      const logIdIdx = logHeaders.indexOf('import_id')
      const logRow = logValues.slice(1).find((row) => (row[logIdIdx] || '') === importId)
      if (!logRow) return res.status(404).json({ success: false, error: 'ไม่พบรายการนำเข้านี้' })

      // ชื่อคอลัมน์ tabs จริงในชีทคือ "target_sheet" ไม่ใช่ "tabs" (เคยพลาดตรงนี้มาแล้ว ทำให้ลบ
      // "สำเร็จ" แต่ไม่ลบอะไรเลยจริงๆ) — เผื่อชื่อคอลัมน์เปลี่ยนอีกในอนาคต ถ้าหาคอลัมน์ไม่เจอหรือ
      // ได้ tabs ว่าง ให้ fallback ไปสแกนทุก tab raw_orders_* แทน กันเงียบไม่ลบอะไรเลยแบบเดิม
      const tabsIdx = logHeaders.indexOf('target_sheet') >= 0 ? logHeaders.indexOf('target_sheet') : logHeaders.indexOf('tabs')
      let tabs = tabsIdx >= 0 ? (logRow[tabsIdx] || '').split(',').map((t) => t.trim()).filter(Boolean) : []
      if (!tabs.length) {
        const meta = await getMeta()
        tabs = meta.sheets.map((s) => s.properties.title).filter((t) => t.startsWith('raw_orders'))
      }

      let deleted = 0
      for (const tab of tabs) {
        const vr = await batchGetValues([`${tab}!A:Z`])
        const values = vr[0]?.values || []
        if (!values.length) continue
        const headers = values[0]
        const idIdx = headers.indexOf('import_id')
        // NOTE: อ่านให้ครบทุกคอลัมน์ (A:Z) — เดิมเป็น A:R ทำให้ province + shipping_option/fulfillment_type
        // (คอลัมน์ S,T,U) หลุดหายทุกครั้งที่ลบล็อต เพราะ overwriteSheet เขียนกลับตามที่อ่านมาเท่านั้น
        const kept = values.slice(1).filter((row) => (row[idIdx] || '') !== importId)
        if (values.length - 1 === kept.length) continue // ไม่มีแถวของ import นี้ใน tab นี้ ข้ามไป ไม่ต้องเขียนทับเปล่าๆ
        deleted += values.length - 1 - kept.length
        await overwriteSheet(tab, headers, kept)
      }

      // soft-delete: เก็บ log ไว้แต่เปลี่ยน status กันโผล่ในประวัติ/กันนำ importId ซ้ำมาลบวนซ้ำ
      const statusIdx = logHeaders.indexOf('status')
      const deletedAtIdx = logHeaders.indexOf('deleted_at')
      const deletedRowsIdx = logHeaders.indexOf('deleted_rows')
      const updatedLog = logValues.slice(1).map((row) => {
        if ((row[logIdIdx] || '') !== importId) return row
        const next = [...row]
        next[statusIdx] = 'deleted'
        if (deletedAtIdx >= 0) next[deletedAtIdx] = new Date().toISOString()
        if (deletedRowsIdx >= 0) next[deletedRowsIdx] = String(deleted)
        return next
      })
      await overwriteSheet('import_log', logHeaders, updatedLog)

      return res.status(200).json({ success: true, deleted, tabs })
    }

    if (req.method === 'GET' && req.query.view === 'mapping-options') {
      const aliases = await getSheet('product_aliases')
      const products = new Map()
      for (const a of aliases) if (a.master_sku && !products.has(a.master_sku)) products.set(a.master_sku, { master_sku: a.master_sku, display_name: a.display_name || a.master_sku })
      return res.status(200).json({ success: true, products: [...products.values()].sort((a, b) => a.display_name.localeCompare(b.display_name, 'th')) })
    }

    if (req.method === 'POST' && req.query.view === 'map-product') {
      const productName = String(req.body?.productName || '').trim()
      const variation = String(req.body?.variation || '').trim()
      const masterSku = String(req.body?.masterSku || '').trim()
      const newDisplayName = String(req.body?.displayName || '').trim()
      const bizIn = String(req.body?.business || '').trim()
      const platIn = String(req.body?.platform || '').trim()
      if (!productName || !masterSku) return res.status(400).json({ success: false, error: 'ต้องระบุชื่อสินค้าและ master SKU' })

      const aliases = await getSheet('product_aliases')
      const target = aliases.find((a) => String(a.master_sku).trim() === masterSku)
      const displayName = target?.display_name || newDisplayName || masterSku
      // รวม variation เข้า alias_key ด้วยเสมอ — ชื่อสินค้าเดียวกันอาจมีหลายไซส์/สี ที่ต้องแมป
      // ไปคนละ SKU กัน (เช่น "2in1 Gel Socks" ไซส์ M → PY006, ไซส์ L → PY007) ถ้าไม่ใส่ variation
      // จะไปจับคู่แบบชื่อกว้างๆ (aliasByName) ที่ไม่สนไซส์ ทำให้ไซส์อื่นถูกแมปผิด SKU ไปด้วย
      const alreadyExists = aliases.some((a) =>
        String(a.alias_product_name).trim() === productName &&
        String(a.alias_variation || '').trim() === variation &&
        String(a.master_sku).trim() === masterSku
      )
      if (!alreadyExists) {
        const vr = await batchGetValues(['product_aliases!A1:Z1'])
        const headers = vr[0]?.values?.[0] || ['master_sku', 'display_name', 'business', 'platform', 'alias_product_name', 'alias_variation', 'alias_key', 'created_at']
        const values = {
          master_sku: masterSku, display_name: displayName, business: bizIn || target?.business || '', platform: platIn || target?.platform || '',
          alias_product_name: productName, alias_variation: variation, alias_key: `${productName}|${variation}`, created_at: new Date().toISOString(),
        }
        await appendRows('product_aliases', [headers.map((h) => values[h] || '')])
      }
      return res.status(200).json({ success: true, master_sku: masterSku, display_name: displayName })
    }

    // ตรวจวันที่ทั้งไฟล์ก่อนนำเข้าจริง (เรียกครั้งเดียวก่อนแบ่ง batch import) — กันไฟล์ที่วันที่อ่านผิด
    // (เช่น dd/mm สลับ mm/dd) กระจายไปลงเดือนอื่นแบบไม่รู้ตัว
    // - expectedMonth = 'YYYY-MM' เดี่ยวๆ → โหมดไฟล์เดือนเดียว บล็อกทั้งไฟล์ถ้าเจอวันที่นอกเดือนนั้น
    // - expectedMonth = 'multi' หรือไม่ส่งมา → โหมดไฟล์หลายเดือน ไม่บล็อก แค่คืน breakdown ต่อเดือน
    //   ให้ผู้ใช้ดูยืนยันเองว่าจำนวนแถวต่อเดือนสมเหตุสมผล (เผื่อ parse วันที่ผิดจะได้เห็นความผิดปกติ)
    if (req.method === 'POST' && req.query.view === 'validate-dates') {
      const { rows: vRows, expectedMonth } = req.body || {}
      if (!Array.isArray(vRows)) return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลในไฟล์' })

      if (expectedMonth && expectedMonth !== 'multi') {
        const mismatches = []
        for (const row of vRows) {
          const d = isoDate(pick(row, ['date', 'วันที่', 'order creation', 'created time', 'createtime', 'เวลาการชำระ', 'วันเวลาที่ทำการสั่งซื้อ']))
          if (d && d.slice(0, 7) !== expectedMonth) {
            if (mismatches.length < 10) mismatches.push(d)
          }
        }
        return res.status(200).json({ success: true, mismatchCount: mismatches.length, mismatchSamples: [...new Set(mismatches)] })
      }

      const monthBreakdown = {}
      let unparseable = 0
      for (const row of vRows) {
        const d = isoDate(pick(row, ['date', 'วันที่', 'order creation', 'created time', 'createtime', 'เวลาการชำระ', 'วันเวลาที่ทำการสั่งซื้อ']))
        if (!d) { unparseable++; continue }
        const m = d.slice(0, 7)
        monthBreakdown[m] = (monthBreakdown[m] || 0) + 1
      }
      return res.status(200).json({ success: true, monthBreakdown, unparseable })
    }

    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
    const { fileName = 'upload.xlsx', platform: platformSel = 'auto', business: bizSel = '', rows, expectedMonth = '' } = req.body || {}
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลในไฟล์' })

    // เช็คซ้ำอีกชั้น (เผื่อ client ข้ามการเช็คตอนแรกไป) — ถ้าแถวไหนในชุดนี้ไม่ตรงเดือนที่เลือก บล็อกทั้ง batch
    // (ข้ามการเช็คนี้ถ้าเป็นโหมดหลายเดือน — 'multi' แปลว่าตั้งใจให้กระจายหลายเดือนอยู่แล้ว)
    if (expectedMonth && expectedMonth !== 'multi') {
      for (const row of rows) {
        const d = isoDate(pick(row, ['date', 'วันที่', 'order creation', 'created time', 'createtime', 'เวลาการชำระ', 'วันเวลาที่ทำการสั่งซื้อ']))
        if (d && d.slice(0, 7) !== expectedMonth) {
          return res.status(400).json({ success: false, error: `พบวันที่ไม่ตรงเดือนที่เลือก (${expectedMonth}) เช่น ${d} — ยกเลิกการนำเข้าทั้งไฟล์` })
        }
      }
    }

    // ตรวจแพลตฟอร์มครั้งเดียวจากแถวแรกของไฟล์ (ไฟล์ export หนึ่งไฟล์เป็นแพลตฟอร์มเดียวเสมอ) — ถ้าเดา
    // ไม่ได้เลยและผู้ใช้ไม่ได้เลือกเอง ให้บังคับเลือกแทนที่จะเดาผิดเงียบๆ (เคยทำให้ TikTok Shop
    // กลายเป็น Shopee ในข้อมูลมาแล้ว เพราะไฟล์นั้นไม่มีคำว่า "tiktok" ในหัวคอลัมน์เลย)
    const platform = platformSel !== 'auto' ? platformSel : detectPlatform(rows[0] || {})
    if (!platform) return res.status(400).json({ success: false, error: 'ตรวจแพลตฟอร์มจากไฟล์อัตโนมัติไม่ได้ กรุณาเลือกแพลตฟอร์มเอง (Shopee / TikTok Shop / Lazada) ก่อนนำเข้า' })

    // ---- alias lookup ----
    const aliasByKey = new Map(), aliasByName = new Map()
    try {
      const aliases = await getSheet('product_aliases')
      for (const a of aliases) {
        if (a.alias_key) aliasByKey.set(normalize(a.alias_key), { master_sku: a.master_sku, display_name: a.display_name })
        const nm = normalize(a.alias_product_name || a.display_name)
        if (nm && !aliasByName.has(nm)) aliasByName.set(nm, { master_sku: a.master_sku, display_name: a.display_name })
      }
    } catch { /* ignore */ }

    const importId = genImportId()
    const importedAt = new Date().toISOString()

    // ---- map แต่ละแถว → raw schema, จัดกลุ่มตามเดือน ----
    const byMonth = new Map() // 'raw_orders_YYYY_MM' -> [rowArray]
    const seenInFile = new Set()
    let mapped = 0, skippedInvalid = 0
    const unmappedSamples = []

    const itemCounter = new Map() // orderId -> next line number, for orders with no explicit item id

    for (const row of rows) {
      const orderId = String(pick(row, ['order_id', 'order id', 'เลขที่คำสั่งซื้อ', 'order sn', 'orderid', 'หมายเลขคำสั่งซื้อ', 'ordernumber']) || '')
      let orderItemId = String(pick(row, ['order_item_id', 'order item id', 'item id', 'orderitemid']) || '')
      const date = isoDate(pick(row, ['date', 'วันที่', 'order creation', 'created time', 'createtime', 'เวลาการชำระ', 'วันเวลาที่ทำการสั่งซื้อ']))
      if (!orderId || !date) { skippedInvalid++; continue }
      const business = pick(row, ['business', 'ธุรกิจ', 'แบรนด์', 'brand']) || bizSel
      const skuPlatform = pick(row, ['sku_platform', 'seller sku', 'sku reference', 'เลขอ้างอิง sku (sku reference no.)', 'sku'])
      const productName = pick(row, ['product_name', 'ชื่อสินค้า', 'product name', 'สินค้า', 'itemname'])
      const variation = pick(row, ['variation_name', 'variation', 'ชื่อตัวเลือก', 'ตัวเลือกสินค้า', 'ประเภทสินค้า'])
      const qty = parseInt(pick(row, ['qty', 'quantity', 'จำนวน', 'amount']), 10) || 1
      // ระวัง: candidate 'total' แบบกว้างๆ จะไปแมตช์ "SKU Subtotal Before Discount" ของ TikTok Shop
      // โดยไม่ตั้งใจ (เพราะ "subtotal" มีคำว่า "total" อยู่ในนั้น) แล้วได้ราคาก่อนหักส่วนลดมาแทน
      // ราคาที่จ่ายจริง — ต้องใส่ชื่อคอลัมน์จริงของ TikTok ("SKU Subtotal After Discount"/"Order
      // Amount") เป็น candidate แบบ exact-match ไว้ก่อน กัน pass 2 (substring) ไปจับผิดคอลัมน์
      const revenue = num(pick(row, ['revenue', 'ยอดขาย', 'sku subtotal after discount', 'order amount', 'total', 'ราคาขายสุทธิ', 'grand total', 'ยอดรวม', 'paidprice']))
      const status = pick(row, ['order_status', 'status', 'สถานะ', 'order status']) || ''
      // province ว่างเปล่าทุกแถวมาตลอด (withProvince=0 จาก 240k+ ออเดอร์ ตรวจพบ 2026-08-25) — ไม่ใช่ที่ pick()
      // นี้เลย ต้นตอจริงคือ Upload.jsx (slimRow/RELEVANT_HEADER_HINTS) กรองคอลัมน์จังหวัดทิ้งไปตั้งแต่ฝั่ง client
      // ก่อนส่งมาถึง endpoint นี้ด้วยซ้ำ — แก้แล้วที่นั่น ตรงนี้ pick ตามปกติ
      // Lazada ต่างจาก Shopee/TikTok: export มาส์กที่อยู่ผู้ซื้อทั้งหมด (ชื่อ/เมือง) เป็น "ค*a" เพื่อความเป็น
      // ส่วนตัว ไม่มีคอลัมน์จังหวัดที่อ่านได้ตรงๆ เลย — เหลือแค่รหัสไปรษณีย์ (shippingPostCode) ที่ไม่มาส์ก
      // เมื่อ pick ตรงๆ ไม่เจอ ถอยไปเดาจากรหัสไปรษณีย์แทน (ดู api/_lib/zipToProvince.js)
      let province = pick(row, ['province', 'จังหวัด', 'ship province', 'buyer province']) || ''
      if (!province) {
        const zip = String(pick(row, ['shippingpostcode', 'postal code', 'ไปรษณีย์', 'zip', 'zipcode']) || '').trim().slice(0, 5)
        if (ZIP_TO_PROVINCE[zip]) province = ZIP_TO_PROVINCE[zip]
      }

      // ประเภทการจัดส่ง — เก็บค่าดิบตามที่แพลตฟอร์มส่งมา ไม่จำแนกด่วน/ธรรมดาตรงนี้
      // (จำแนกในชั้น dashboard ผ่าน api/_lib/shippingClass.js เพื่อปรับกฎได้โดยไม่ต้อง import ใหม่)
      // Shopee: "ตัวเลือกการจัดส่ง" (เช่น "Standard Delivery - ส่งธรรมดาในประเทศ-SPX Express")
      // Lazada: "deliveryType" (STANDARD/EXPRESS/...)  TikTok: "Delivery Option" (การจัดส่งแบบมาตรฐาน/ด่วน)
      const shippingOption = String(pick(row, ['ตัวเลือกการจัดส่ง', 'delivery option', 'deliverytype', 'delivery type', 'shipping option']) || '').trim()
      const fulfillmentType = String(pick(row, ['fulfillment type', 'fulfillmenttype']) || '').trim()

      // ไฟล์ export บางแพลตฟอร์ม (เช่น Shopee) ไม่มีคอลัมน์ item id แยกต่างหาก —
      // ถ้าไม่มี ให้ไล่เลขบรรทัดต่อออเดอร์ กันไม่ให้ order ที่มีหลายสินค้าถูกมองว่าเป็นแถวซ้ำ
      if (!orderItemId) {
        const n = (itemCounter.get(orderId) || 0) + 1
        itemCounter.set(orderId, n)
        orderItemId = `L${n}`
      }

      const orderKey = `${platform}:${orderId}:${orderItemId}`
      if (seenInFile.has(orderKey)) continue
      seenInFile.add(orderKey)

      const aliasKey = `${normalize(productName)}|${normalize(variation)}`
      const alias = aliasByKey.get(aliasKey) || aliasByName.get(normalize(productName))
      if (alias) mapped++
      else if (productName) {
        // เก็บคู่ชื่อ+variation แยกกัน ไม่ใช่แค่ชื่อ — ชื่อเดียวกันแต่คนละไซส์ต้องโชว์แยก ไม่งั้นผู้ใช้
        // ไม่มีทางรู้ว่าแถวที่ยังไม่จับคู่นี้เป็นไซส์ไหน จะเลือก SKU ปลายทางถูกได้ยังไง
        const dupeKey = `${productName}|${variation}`
        if (unmappedSamples.length < 20 && !unmappedSamples.some((s) => `${s.productName}|${s.variation}` === dupeKey)) {
          unmappedSamples.push({ productName, variation })
        }
      }

      const tab = `raw_orders_${date.slice(0, 4)}_${date.slice(5, 7)}`
      if (!byMonth.has(tab)) byMonth.set(tab, [])
      byMonth.get(tab).push({
        orderKey,
        arr: [orderKey, forceText(orderId), forceText(orderItemId), date, platform, business, forceText(skuPlatform), productName, variation, alias?.master_sku || '', alias?.display_name || productName, qty, revenue, status, importedAt, fileName, importId, aliasKey, province, shippingOption, fulfillmentType],
      })
    }

    // ---- กันซ้ำกับข้อมูลเดิม (อ่าน order_key คอลัมน์ A ของ tab ที่เกี่ยวข้อง) ----
    const tabs = [...byMonth.keys()]
    let skippedDup = 0, imported = 0
    if (tabs.length) {
      let existing = []
      try { existing = await batchGetValues(tabs.map((t) => `${t}!A:A`)) } catch { existing = [] }
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i]
        const existSet = new Set((existing[i]?.values || []).flat())
        const fresh = byMonth.get(tab).filter((r) => { if (existSet.has(r.orderKey)) { skippedDup++; return false } return true })
        if (fresh.length) {
          await appendRows(tab, fresh.map((r) => r.arr))
          imported += fresh.length
        }
      }
    }

    // ---- บันทึก import_log ----
    try {
      await appendRows('import_log', [[importId, fileName, bizSel || (byMonth.size ? '' : ''), platformSel === 'auto' ? '' : platformSel, imported, mapped, imported - mapped, importedAt, tabs.join(','), 'active']])
    } catch { /* ignore */ }

    res.status(200).json({ success: true, importId, imported, mapped, skipped: skippedDup + skippedInvalid, skippedDup, skippedInvalid, unmappedSamples, tabs })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
}
