// audit-duplicate-orders — ตรวจ "คีย์ซ้ำ / ยอดซ้ำ" ในแท็บ raw_orders_* ทั้งหมด (อ่านอย่างเดียว ไม่แก้ชีต)
//
//   node --env-file=.env scripts/audit-duplicate-orders.mjs            # สรุปทุกเดือน
//   node --env-file=.env scripts/audit-duplicate-orders.mjs 2026       # เฉพาะปี
//   node --env-file=.env scripts/audit-duplicate-orders.mjs 2026_08    # เฉพาะเดือน
//   node --env-file=.env scripts/audit-duplicate-orders.mjs --csv out.csv   # ดัมพ์แถวที่ซ้ำเป็น CSV
//
// ตรวจ 4 อย่าง:
//   1) order_key ซ้ำในแท็บเดียวกัน — upsert ควรกันได้ ถ้าเจอ = แถวตกค้างจากก่อนมี upsert หรือจาก
//      idxByKey ที่เก็บ index สุดท้ายตัวเดียว (แก้ได้แถวเดียว อีกแถวค้างถาวร)
//   2) order_key ซ้ำข้ามแท็บ (คนละเดือน) — upsert หาคีย์เฉพาะในแท็บของเดือนนั้น ข้ามเดือนจึงไม่เจอกัน
//      เกิดได้จาก timezone (API +7h เอง vs ไฟล์ export ที่เป็นเวลาไทยแล้ว) ออเดอร์ดึกสิ้นเดือนเพี้ยน
//   3) ออเดอร์เดียวกัน (platform:order_id) มีทั้งแถวที่ order_item_id เป็น fallback "L1/L2.." และแถวที่
//      เป็น item id จริง — คือเคส TikTok API sync ชนกับการอัพไฟล์ export ด้วยมือ (API ใช้ li.id,
//      ไฟล์ export ไม่มีคอลัมน์ item id เลยตกไป fallback) = ออเดอร์เดียวนับ 2 รอบ
//   4) order_key ว่าง — แถวที่ upsert มองไม่เห็น ซ้ำได้เรื่อยๆ ทุกครั้งที่อัพไฟล์
//
// "ยอดซ้ำ" = ผลรวม revenue ของแถวส่วนเกิน (นับแถวแรกของแต่ละคีย์เป็นตัวจริง ที่เหลือคือส่วนเกิน)
// ตรงกับที่ dashboard/monthly/products/planner-sales บวกเกินจริง เพราะฝั่งอ่านไม่แตะ order_key เลย
import { writeFileSync } from 'node:fs'
import { getMetaCached, batchGetValues } from '../api/_lib/sheets.js'

const args = process.argv.slice(2)
const csvIdx = args.indexOf('--csv')
const csvPath = csvIdx >= 0 ? args[csvIdx + 1] : null
const filter = args.filter((a, i) => csvIdx < 0 || (i !== csvIdx && i !== csvIdx + 1))[0] || ''

const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const isCancelled = (s) => /ยกเลิก|cancel/i.test(String(s || ''))
const baht = (n) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 })
const FALLBACK_ITEM_ID = /^L\d+$/ // item id ที่ import สร้างเองตอนไฟล์ไม่มีคอลัมน์ item id

async function main() {
  const meta = await getMetaCached()
  const tabs = meta.sheets
    .map((s) => s.properties.title)
    .filter((t) => t.startsWith('raw_orders') && (!filter || t.includes(filter)))
    .sort()
  if (!tabs.length) { console.error('ไม่เจอแท็บ raw_orders ที่ตรงเงื่อนไข'); process.exit(1) }

  console.log(`\nอ่าน ${tabs.length} แท็บ: ${tabs.join(', ')}\n`)

  // A:I = order_key, order_id, order_item_id, date, platform, business, sku_platform, product_name, variation_name ; L:N = qty, revenue, status
  // อ่านทีละ 12 แท็บ กัน response ก้อนเดียวใหญ่เกิน
  const all = []
  for (let i = 0; i < tabs.length; i += 12) {
    const chunk = tabs.slice(i, i + 12)
    const vr = await batchGetValues(chunk.flatMap((t) => [`${t}!A:I`, `${t}!L:N`]))
    chunk.forEach((tab, k) => {
      const head = vr[k * 2]?.values || []
      const tail = vr[k * 2 + 1]?.values || []
      // ข้ามแถว header (index 0) — เลขแถวจริงในชีต = index + 1
      for (let r = 1; r < head.length; r++) {
        const h = head[r] || [], t = tail[r] || []
        if (!h.some((c) => String(c ?? '').trim())) continue // แถวว่างล้วน
        all.push({
          tab,
          rowNo: r + 1,
          key: String(h[0] ?? '').trim(),
          orderId: String(h[1] ?? '').replace(/^'/, '').trim(),
          itemId: String(h[2] ?? '').replace(/^'/, '').trim(),
          date: String(h[3] ?? '').trim(),
          platform: String(h[4] ?? '').trim(),
          business: String(h[5] ?? '').trim(),
          qty: parseInt(t[0], 10) || 0,
          revenue: num(t[1]),
          status: String(t[2] ?? '').trim(),
          productName: String(h[7] ?? '').trim(),
          variation: String(h[8] ?? '').trim(),
        })
      }
    })
  }

  const live = all.filter((r) => !isCancelled(r.status))
  console.log(`รวม ${all.length.toLocaleString()} แถว (ไม่ยกเลิก ${live.length.toLocaleString()} แถว, ยอด ${baht(live.reduce((s, r) => s + r.revenue, 0))} บาท)\n`)

  const dupRows = [] // แถวส่วนเกินทั้งหมด (ไว้ดัมพ์ CSV)

  const report = (title, groups, kindLabel) => {
    let extraRows = 0, extraRevenue = 0, extraLive = 0, extraLiveRevenue = 0
    const worst = []
    for (const [gkey, rows] of groups) {
      const extra = rows.slice(1) // แถวแรก = ตัวจริง ที่เหลือคือส่วนเกิน
      const extraLiveRows = extra.filter((r) => !isCancelled(r.status))
      extraRows += extra.length
      extraRevenue += extra.reduce((s, r) => s + r.revenue, 0)
      extraLive += extraLiveRows.length
      extraLiveRevenue += extraLiveRows.reduce((s, r) => s + r.revenue, 0)
      worst.push({ gkey, n: rows.length, rev: extraLiveRows.reduce((s, r) => s + r.revenue, 0), rows })
      for (const r of extra) dupRows.push({ kind: kindLabel, group: gkey, ...r })
    }
    console.log(`── ${title}`)
    if (!groups.size) { console.log('   ไม่พบ\n'); return }
    console.log(`   กลุ่มที่ซ้ำ: ${groups.size.toLocaleString()} | แถวส่วนเกิน: ${extraRows.toLocaleString()} (ไม่ยกเลิก ${extraLive.toLocaleString()})`)
    console.log(`   ยอดที่นับเกินจริง: ${baht(extraLiveRevenue)} บาท (รวมที่ยกเลิกด้วย ${baht(extraRevenue)} บาท)`)
    worst.sort((a, b) => b.rev - a.rev || b.n - a.n)
    for (const w of worst.slice(0, 8)) {
      console.log(`     ${w.gkey}  ×${w.n}  +${baht(w.rev)}฿`)
      for (const r of w.rows.slice(0, 4)) {
        console.log(`        ${r.tab}!${r.rowNo}  item:${r.itemId || '(ว่าง)'}  ${r.date}  qty:${r.qty}  ${baht(r.revenue)}฿  ${r.status || '-'}  ตัวเลือก:"${r.variation || '-'}"`)
      }
      if (w.rows.length > 4) console.log(`        ... อีก ${w.rows.length - 4} แถว`)
    }
    if (worst.length > 8) console.log(`     ... อีก ${worst.length - 8} กลุ่ม`)
    console.log('')
  }

  const groupBy = (rows, fn) => {
    const m = new Map()
    for (const r of rows) {
      const k = fn(r)
      if (!k) continue
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
    return new Map([...m].filter(([, v]) => v.length > 1))
  }

  // 1) order_key ซ้ำในแท็บเดียวกัน — แยก 2 แบบ เพราะแก้คนละทาง:
  //    (ก) "ซ้ำจริง" ข้อมูลเหมือนกันทุกช่อง (สินค้า/ตัวเลือก/จำนวน/ยอด/สถานะ) = แถวเกินจริง ยอดเบิ้ล
  //    (ข) "คีย์ชนกัน" ข้อมูลต่างกัน = คนละรายการสินค้าจริงในออเดอร์เดียวกัน แต่ได้ order_key เดียวกัน
  //        (แถวเก่าที่ order_item_id ว่าง คีย์เลยลงท้ายด้วยชื่อสินค้าแทน ชนกันเองเมื่อออเดอร์เดียวมี
  //        สินค้าชื่อเดียวกันหลายตัวเลือก) — ยอดไม่ได้เบิ้ล แต่อันตรายตอน import ทับ: upsert
  //        จะเห็นเป็นคีย์เดียว แก้ได้แถวเดียว ที่เหลือค้าง/ข้อมูลเพี้ยน
  const sameTab = groupBy(all.filter((r) => r.key), (r) => `${r.tab} | ${r.key}`)
  const sig = (r) => `${r.productName}|${r.variation}|${r.qty}|${r.revenue}|${r.status}`
  const itemSig = (r) => `${r.productName}|${r.variation}`
  const trueDup = new Map(), sameItemDiff = new Map(), collision = new Map()
  for (const [k, rows] of sameTab) {
    if (new Set(rows.map(sig)).size === 1) trueDup.set(k, rows)
    else if (new Set(rows.map(itemSig)).size === 1) sameItemDiff.set(k, rows) // สินค้า+ตัวเลือกเดียวกัน แต่ยอด/จำนวน/สถานะต่าง
    else collision.set(k, rows)
  }
  report('1ก. ซ้ำจริง — order_key ซ้ำ + ข้อมูลเหมือนกันทุกช่อง (ยอดเบิ้ลแน่นอน)', trueDup, 'true-dup')
  report('1ข. ซ้ำ-ยอดต่าง — คีย์ซ้ำ + สินค้า/ตัวเลือกเดียวกัน แต่ยอด/จำนวน/สถานะไม่ตรง (น่าจะอัพไฟล์ทับคนละรอบ)', sameItemDiff, 'same-item-diff')
  report('1ค. คีย์ชนกัน — คีย์ซ้ำ แต่คนละตัวเลือกสินค้า (คนละรายการจริง ยอดไม่เบิ้ล แต่ import ทับแล้วเพี้ยน)', collision, 'key-collision')

  // สรุปรายเดือน เฉพาะที่ยอดเบิ้ลจริง (1ก + 1ข) — ดูว่าเดือนไหนต้องล้าง
  const dupLike = new Map([...trueDup, ...sameItemDiff])
  if (dupLike.size) {
    const byTab = new Map()
    for (const [, rows] of dupLike) {
      for (const r of rows.slice(1)) {
        const cur = byTab.get(r.tab) || { rows: 0, rev: 0 }
        cur.rows++
        if (!isCancelled(r.status)) cur.rev += r.revenue
        byTab.set(r.tab, cur)
      }
    }
    console.log('   แถวเกินจาก 1ก+1ข รายเดือน:')
    for (const [tab, v] of [...byTab].sort()) console.log(`     ${tab}: ${v.rows.toLocaleString()} แถว  ${baht(v.rev)}฿`)
    console.log('')
  }

  // 2) order_key เดียวกันโผล่ข้ามแท็บ (คนละเดือน)
  const crossTab = new Map()
  for (const [k, rows] of groupBy(all.filter((r) => r.key), (r) => r.key)) {
    if (new Set(rows.map((r) => r.tab)).size > 1) crossTab.set(k, rows)
  }
  report('2. order_key เดียวกันอยู่คนละแท็บ/เดือน (upsert หาไม่เจอข้ามเดือน)', crossTab, 'cross-tab-key')

  // 3) ออเดอร์เดียวกันมีทั้ง item id จริง และ fallback L1/L2 — TikTok API sync ชนกับอัพไฟล์มือ
  const mixed = new Map()
  for (const [k, rows] of groupBy(all, (r) => (r.platform && r.orderId ? `${r.platform}:${r.orderId}` : ''))) {
    const fb = rows.some((r) => FALLBACK_ITEM_ID.test(r.itemId))
    const real = rows.some((r) => r.itemId && !FALLBACK_ITEM_ID.test(r.itemId))
    if (fb && real) mixed.set(k, rows)
  }
  report('3. ออเดอร์เดียวกันมีทั้ง item id จริง + fallback L1/L2 (API sync ชนไฟล์อัพมือ)', mixed, 'mixed-itemid')

  // 4) order_key ว่าง — upsert มองไม่เห็น ซ้ำได้ทุกรอบที่อัพ
  const blanks = all.filter((r) => !r.key)
  console.log('── 4. แถวที่ order_key ว่าง (upsert มองไม่เห็น)')
  if (!blanks.length) console.log('   ไม่พบ\n')
  else {
    const byTab = new Map()
    for (const r of blanks) byTab.set(r.tab, (byTab.get(r.tab) || 0) + 1)
    console.log(`   ${blanks.length.toLocaleString()} แถว | ยอด ${baht(blanks.filter((r) => !isCancelled(r.status)).reduce((s, r) => s + r.revenue, 0))} บาท`)
    for (const [tab, n] of byTab) console.log(`     ${tab}: ${n.toLocaleString()} แถว`)
    console.log('')
    for (const r of blanks) dupRows.push({ kind: 'blank-key', group: '(order_key ว่าง)', ...r })
  }

  if (csvPath) {
    const cols = ['kind', 'group', 'tab', 'rowNo', 'key', 'orderId', 'itemId', 'date', 'platform', 'business', 'qty', 'revenue', 'status']
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [cols.join(','), ...dupRows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
    writeFileSync(csvPath, '﻿' + csv, 'utf8') // BOM กัน Excel อ่านภาษาไทยเพี้ยน
    console.log(`เขียน CSV แถวที่ซ้ำ ${dupRows.length.toLocaleString()} แถว → ${csvPath}\n`)
  }
}

main().catch((e) => { console.error('พัง:', e.message); process.exit(1) })
