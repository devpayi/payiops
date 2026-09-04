// Port ของ generate_proforma.py — สร้าง PROFORMA INVOICE + packing list (.xlsx) ฝั่ง client
// layout/merge/border/fill/สูตร/ตำแหน่งรูป ตรงกับไฟล์จริง A24xxx
// exceljs โหลดแบบ dynamic import (เรียกตอนกดคอนเฟิร์มเท่านั้น)

const thin = { style: 'thin' }
const BOX = { top: thin, left: thin, bottom: thin, right: thin }
const GREY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } }
const SALMON = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD99594' } }
const WHITE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
const F_HD = { name: 'Arial', size: 11, bold: true }
const F_TX = { name: 'Arial', size: 11 }
const F_TITLE = { name: 'Arial', size: 20, bold: true }
const F_MID = { name: 'Calibri', size: 11 }
const CTR = { horizontal: 'center', vertical: 'middle', wrapText: true }
const CTRW = { horizontal: 'center', vertical: 'middle' }
const LFT = { horizontal: 'left', vertical: 'middle' }
const TOPL = { horizontal: 'left', vertical: 'top', wrapText: true }

const num = (v, d = 0) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : d
}
// ISO (2026-09-04) -> DD-MM-YY (04-09-26) ตามไฟล์จริง
const fmtDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  return m ? `${m[3]}-${m[2]}-${m[1].slice(2)}` : String(iso || '')
}
// Description = ชื่อจีน - ชื่อไทย (เหมือนไฟล์ทำมือ)
const descOf = (row) => [row.name_zh, row.name_th].map((s) => String(s || '').trim()).filter(Boolean).join(' - ')
const r1 = (n) => Math.round(n * 10) / 10
const r2 = (n) => Math.round(n * 100) / 100

function imgSize(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl || typeof Image === 'undefined') return resolve(dataUrl ? { w: 1, h: 1 } : null)
    const im = new Image()
    im.onload = () => resolve({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 })
    im.onerror = () => resolve(null)
    im.src = dataUrl
  })
}

function set(ws, coord, value, { font = F_TX, fill = null, align = CTRW, border = null, numFmt = null } = {}) {
  const c = ws.getCell(coord)
  c.value = value
  c.font = font
  if (fill) c.fill = fill
  c.alignment = align
  if (border) c.border = border
  if (numFmt) c.numFmt = numFmt
  return c
}
const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26 } return s }
const colIdx = (L) => [...L].reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0)

/**
 * @param {{supplier_name_zh?:string, supplier_ref?:string, contract_label?:string, invoice_date?:string, consignee_to?:string}} info
 * @param {Array<{no:number, name_en:string, name_th:string, image?:string|null,
 *   rows:Array<{sku:string, qty:number, name_zh:string, name_th:string, cartons:Array<{count:number,wt:number,l:number,w:number,h:number}>}>}>} groups
 * @returns {Promise<Blob>}
 */
export async function generateProforma(info, groups) {
  const ExcelJS = (await import('exceljs')).default || (await import('exceljs'))
  const wb = new ExcelJS.Workbook()

  const imgById = new Map()
  const addImg = async (ws, dataUrl, anchorCol0, anchorRow0, maxW) => {
    if (!dataUrl) return
    const sz = await imgSize(dataUrl)
    if (!sz) return
    let id = imgById.get(dataUrl)
    if (id === undefined) {
      id = wb.addImage({ base64: dataUrl, extension: dataUrl.includes('image/png') ? 'png' : 'jpeg' })
      imgById.set(dataUrl, id)
    }
    const ratio = sz.h / sz.w
    ws.addImage(id, { tl: { col: anchorCol0, row: anchorRow0 }, ext: { width: maxW, height: Math.round(maxW * ratio) } })
  }

  // ================= SHEET 1 : INVOICE =================
  const inv = wb.addWorksheet('INVOICE')
  ;['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].forEach((L, i) => {
    inv.getColumn(i + 1).width = [8.9, 12.7, 14, 20, 16, 60.3, 18.7, 18.7, 8.9][i]
  })

  inv.mergeCells('B3:H5')
  set(inv, 'B3', info.supplier_ref || info.supplier_name_zh || '', { font: F_TX })
  for (let r = 3; r <= 5; r++) for (const L of 'BCDEFGH') inv.getCell(`${L}${r}`).border = BOX
  inv.mergeCells('B6:H6'); set(inv, 'B6', info.contract_label || '合同', { font: F_MID })
  inv.mergeCells('B7:H7'); set(inv, 'B7', 'PROFORMA INVOICE', { font: F_MID })
  inv.mergeCells('G9:H9'); set(inv, 'G9', `DATE：${fmtDate(info.invoice_date)}`, { font: F_MID, align: { horizontal: 'right', vertical: 'middle' } })
  inv.mergeCells('B10:B13'); set(inv, 'B10', 'To:', { font: F_MID, align: { horizontal: 'left', vertical: 'top' } })
  inv.mergeCells('C10:F13'); set(inv, 'C10', info.consignee_to || '', { font: F_MID, align: TOPL })

  inv.mergeCells('D15:E15'); inv.mergeCells('D16:E16'); inv.mergeCells('B16:B17')
  inv.mergeCells('C16:C17'); inv.mergeCells('F16:F17')
  const ihdr = {
    B15: 'No.', C15: 'Quantity', D15: 'Product Name', F15: 'Description', G15: 'Unit Price', H15: 'Total',
    B16: 'รายการที่', C16: 'จำนวนสินค้า(pcs.)', D16: 'ชื่อสินค้า ', F16: 'คำอธิบายสินค้า', G16: 'ราคาต่อหน่วย', H16: 'ผลรวมราคาทั้งหมด',
    D17: 'English', E17: 'ไทย',
  }
  for (const [c, v] of Object.entries(ihdr)) set(inv, c, v, { font: F_HD, fill: GREY, align: CTR, border: BOX })
  set(inv, 'G17', 'RMB', { font: F_HD, fill: SALMON, align: CTR, border: BOX })
  set(inv, 'H17', 'RMB', { font: F_HD, fill: SALMON, align: CTR, border: BOX })
  for (const c of ['B17', 'C17', 'F17']) { inv.getCell(c).fill = GREY; inv.getCell(c).border = BOX }

  let r = 18
  const firstData = r
  let totQty = 0
  for (const g of groups) {
    const gStart = r
    for (const row of g.rows) {
      const qty = Math.round(num(row.qty))
      totQty += qty
      set(inv, `C${r}`, qty, { border: BOX })
      set(inv, `F${r}`, descOf(row), { align: LFT, border: BOX })
      set(inv, `G${r}`, null, { border: BOX })
      set(inv, `H${r}`, { formula: `C${r}*G${r}` }, { fill: WHITE, border: BOX, numFmt: '#,##0.00' })
      for (const L of 'BDE') inv.getCell(`${L}${r}`).border = BOX
      inv.getRow(r).height = g.rows.length === 1 ? 60 : 22
      r++
    }
    const gEnd = r - 1
    if (gEnd > gStart) for (const L of 'BDE') inv.mergeCells(`${L}${gStart}:${L}${gEnd}`)
    set(inv, `B${gStart}`, g.no, { border: BOX })
    set(inv, `D${gStart}`, g.name_en || '', { align: LFT, border: BOX })
    set(inv, `E${gStart}`, g.name_th || '', { align: LFT, border: BOX })
    await addImg(inv, g.image, colIdx('F') - 1, gStart - 1, 95)
  }
  for (const L of 'BCDEFGH') inv.getCell(`${L}${r}`).border = BOX
  set(inv, `C${r}`, { formula: `SUM(C${firstData}:C${r - 1})` }, { font: F_HD, border: BOX })
  set(inv, `H${r}`, { formula: `SUM(H${firstData}:H${r - 1})` }, { font: F_HD, border: BOX, numFmt: '#,##0.00' })
  for (let rr = 3; rr <= r; rr++) if (!inv.getRow(rr).height) inv.getRow(rr).height = 18.6

  // ================= SHEET 2 : packing list =================
  const pk = wb.addWorksheet('packing list ')
  ;['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].forEach((L, i) => {
    pk.getColumn(i + 1).width = [14.6, 12, 23.3, 43.3, 14.2, 15.1, 13.4, 12.1, 12, 12, 13.6, 13.6][i]
  })
  const pset = (coord, v, opt = {}) => set(pk, coord, v, { border: BOX, ...opt })

  pk.mergeCells('A1:L1'); pset('A1', 'Packing List.', { font: F_TITLE, align: CTRW })
  pk.mergeCells('C2:D2'); pk.mergeCells('F2:G2'); pk.mergeCells('H2:L2')
  pk.mergeCells('A3:A4'); pk.mergeCells('B3:B4'); pk.mergeCells('C3:D3')
  pk.mergeCells('E3:E4'); pk.mergeCells('F3:F4'); pk.mergeCells('G3:G4'); pk.mergeCells('H3:K3'); pk.mergeCells('L3:L4')
  const phdr = {
    A2: 'No.', B2: 'Quantity', C2: 'Product Name', E2: 'Carton', F2: 'Weight', H2: 'Dimension',
    A3: 'รายการที่', B3: 'จำนวนสินค้า', C3: 'ชื่อสินค้า ', E3: 'จำนวนกล่อง',
    F3: 'น้ำหนักต่อกล่อง(KG)', G3: 'น้ำหนักรวม (KG)', H3: 'ปริมาตรกล่อง', L3: 'total volume (CBM)',
    C4: 'English', D4: 'ไทย', H4: 'length (CM)', I4: 'width (CM)', J4: 'height (CM)', K4: 'total volume (CBM)',
    E5: '件數', F5: '每件重量(KG)', G5: '总重量(KG)', H5: '长度(CM)', I5: '宽度(CM)', J5: '高度(CM)',
    K5: '总容积 (CBM)', L5: '总容积 (CBM)',
  }
  const bigHd = new Set(['A2', 'B2', 'C2', 'E2', 'F2', 'H2'])
  for (const [c, v] of Object.entries(phdr)) pset(c, v, { font: bigHd.has(c) ? F_HD : F_TX, fill: GREY, align: CTR })
  pk.getRow(4).height = 27.6

  let pr = 6
  const firstPk = pr
  for (const g of groups) {
    const gStart = pr
    for (const row of g.rows) {
      const clist = row.cartons?.length ? row.cartons : [{ count: 1, wt: 0, l: 0, w: 0, h: 0 }]
      const subStart = pr
      for (const cg of clist) {
        const n = Math.max(1, Math.round(num(cg.count, 1)))
        const wt = num(cg.wt), L = num(cg.l), W = num(cg.w), H = num(cg.h)
        for (let k = 0; k < n; k++) {
          pset(`E${pr}`, 1, { align: CTR })
          pset(`F${pr}`, r2(wt), { align: CTRW })
          pset(`G${pr}`, { formula: `E${pr}*F${pr}` }, { align: CTRW })
          pset(`H${pr}`, r1(L), { align: CTRW })
          pset(`I${pr}`, r1(W), { align: CTRW })
          pset(`J${pr}`, r1(H), { align: CTRW })
          pset(`K${pr}`, { formula: `H${pr}*I${pr}*J${pr}*0.000001` }, { align: CTRW, numFmt: '0.00' })
          pset(`L${pr}`, r2(L * W * H / 1e6), { align: CTRW, numFmt: '0.00' })
          for (const cc of 'ABCD') pk.getCell(`${cc}${pr}`).border = BOX
          pk.getRow(pr).height = 15
          pr++
        }
      }
      if (g.rows.length > 1) {
        if (pr - 1 > subStart) pk.mergeCells(`B${subStart}:B${pr - 1}`)
        pset(`B${subStart}`, Math.round(num(row.qty)), { align: CTR })
      }
    }
    const gEnd = pr - 1
    for (const L of 'ACD') if (gEnd > gStart) pk.mergeCells(`${L}${gStart}:${L}${gEnd}`)
    if (g.rows.length === 1 && gEnd > gStart) pk.mergeCells(`B${gStart}:B${gEnd}`)
    pset(`A${gStart}`, g.no, { align: CTR })
    if (g.rows.length === 1) pset(`B${gStart}`, Math.round(num(g.rows[0].qty)), { align: CTR })
    pset(`C${gStart}`, g.name_en || '', { align: LFT })
    pset(`D${gStart}`, g.name_th || '', { align: LFT })
    set(pk, `O${gStart}`, { formula: `SUM(L${gStart}:L${gEnd})` }, { align: CTRW })
    await addImg(pk, g.image, colIdx('D') - 1, gStart - 1, 90)
  }
  for (const L of 'ABCDEFGHIJKL') pk.getCell(`${L}${pr}`).border = BOX
  pset(`B${pr}`, { formula: `SUM(B${firstPk}:B${pr - 1})` }, { font: F_HD, align: CTR })
  pset(`E${pr}`, { formula: `SUM(E${firstPk}:E${pr - 1})` }, { font: F_HD, align: CTR })
  pset(`G${pr}`, { formula: `SUM(G${firstPk}:G${pr - 1})` }, { font: F_HD, align: CTR })
  pset(`L${pr}`, { formula: `SUM(L${firstPk}:L${pr - 1})` }, { font: F_HD, align: CTR, numFmt: '0.00' })

  wb.addWorksheet('Sheet3')

  const buf = await wb.xlsx.writeBuffer()
  return { blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), totQty }
}

export { colLetter }
