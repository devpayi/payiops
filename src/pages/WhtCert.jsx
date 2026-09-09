import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

// ── ค่าคงที่ (ไม่ต้องกรอกทุกครั้ง) ─────────────────────────────
const PAYER = {
  name: 'บริษัท ปลาใหญ่ มาร์เก็ตติ้ง จำกัด (สำนักงานใหญ่)',
  tin: '0125561006907',
  addr: '79 ซอยงามวงศ์วาน 23 ตำบลบางเขน อำเภอเมืองนนทบุรี จังหวัดนนทบุรี 11000',
}
const PAYEE = {
  name: 'บริษัท บิวตี้ แอนด์ เฮลธ์ตี้ คิงดอม จำกัด (สำนักงานใหญ่)',
  tin: '0105555151224',
  addr: '37 ซอยโชคชัย 4 ซอย 23 ถนนโชคชัย 4 แขวงลาดพร้าว เขตลาดพร้าว กรุงเทพมหานคร 10230',
}
const SERVICE_FEE = 3900
const WHT_RATE = 0.03
const BOOK_NO = '001'
const TEMPLATE_URL = '/wht/wht_50tawi_template.pdf'
const FONT_URL = '/wht/Leelawadee.ttf'

// กรอบเลขภาษี 13 หลัก (bottom-origin) : (x0,x1) + จำนวนหลัก  → 1-4-5-2-1
const ID_BOXES = [
  { xs: [374.5, 386.5], n: 1 }, { xs: [392.5, 440.6], n: 4 }, { xs: [447.1, 507.6], n: 5 },
  { xs: [513.1, 537.6], n: 2 }, { xs: [544.5, 556.6], n: 1 },
]
const ID_BOXES_2 = [
  { xs: [375.1, 387.0], n: 1 }, { xs: [393.1, 441.1], n: 4 }, { xs: [447.6, 508.1], n: 5 },
  { xs: [513.6, 538.1], n: 2 }, { xs: [545.1, 557.1], n: 1 },
]

const TH_MONTHS = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
const _O = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
const _P = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']
function grp(s) {
  let out = ''
  const L = s.length
  for (let i = 0; i < L; i++) {
    const d = +s[i], pos = L - i - 1
    if (d === 0) continue
    if (pos === 1 && d === 2) out += 'ยี่สิบ'
    else if (pos === 1 && d === 1) out += 'สิบ'
    else if (pos === 0 && d === 1 && L > 1) out += 'เอ็ด'
    else out += _O[d] + _P[pos]
  }
  return out
}
function bahttext(n) {
  n = Math.round(n * 100) / 100
  let baht = Math.floor(n)
  const sat = Math.round((n - baht) * 100)
  let t = ''
  if (baht >= 1e6) { t += grp(String(Math.floor(baht / 1e6))) + 'ล้าน'; baht %= 1e6 }
  t += baht ? grp(String(baht)) : (t ? '' : 'ศูนย์')
  t += 'บาท'
  t += sat ? grp(String(sat)) + 'สตางค์' : 'ถ้วน'
  return t
}
const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// pdf-lib ไม่ shape ภาษาไทย (วรรณยุกต์ซ้อนสระเพี้ยน/หาย ทั้ง subset true/false) — วาดข้อความไทยลง canvas
// (เบราว์เซอร์ shape ให้ถูก) แล้วฝังเป็นรูปแทน. ตัวเลข/latin ยังใช้ drawText ปกติได้
let _thaiFontReady
async function ensureThaiFont(fontBytes) {
  if (!_thaiFontReady) {
    _thaiFontReady = (async () => {
      const ff = new FontFace('WhtThai', fontBytes)
      await ff.load()
      document.fonts.add(ff)
    })()
  }
  return _thaiFontReady
}
// คืน { url, wPt, hPt } ของข้อความไทย ที่ความสูงตัวอักษร ~sizePt (เรนเดอร์ 4x กัน aliasing)
function thaiTextPng(text, sizePt) {
  const S = 4
  const fontPx = sizePt * S
  const pad = Math.ceil(fontPx * 0.35)
  const meas = document.createElement('canvas').getContext('2d')
  meas.font = `${fontPx}px WhtThai, "Leelawadee UI", "Tahoma", sans-serif`
  const w = Math.ceil(meas.measureText(text).width)
  const cvs = document.createElement('canvas')
  cvs.width = w + pad * 2
  cvs.height = Math.ceil(fontPx * 1.6)
  const ctx = cvs.getContext('2d')
  ctx.font = `${fontPx}px WhtThai, "Leelawadee UI", "Tahoma", sans-serif`
  ctx.fillStyle = '#000'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, pad, Math.ceil(fontPx * 1.15))
  return { url: cvs.toDataURL('image/png'), wPt: cvs.width / S, hPt: cvs.height / S, baselinePt: (fontPx * 1.15) / S }
}

async function buildPdf({ runNo, dateISO, bookNo }) {
  const [tplBytes, fontBytes] = await Promise.all([
    fetch(TEMPLATE_URL).then((r) => r.arrayBuffer()),
    fetch(FONT_URL).then((r) => r.arrayBuffer()),
  ])
  await ensureThaiFont(fontBytes.slice(0))
  const pdf = await PDFDocument.load(tplBytes)
  pdf.registerFontkit(fontkit)
  const thai = await pdf.embedFont(fontBytes, { subset: true })
  const page = pdf.getPage(0)
  const black = rgb(0, 0, 0)

  const d = new Date(dateISO + 'T00:00:00')
  const be = d.getFullYear() + 543
  const dd = d.getDate()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy2 = String(d.getFullYear() % 100).padStart(2, '0')
  const dateShort = `${String(dd).padStart(2, '0')}/${mm}/${yy2}` // ตามไฟล์จริง: ค.ศ. 2 หลัก (2026 -> 26)
  const tax = Math.round(SERVICE_FEE * WHT_RATE * 100) / 100

  const T = (txt, x, y, size = 9) => page.drawText(String(txt), { x, y, size, font: thai, color: black })
  const R = (txt, xRight, y, size = 9) => {
    const w = thai.widthOfTextAtSize(String(txt), size)
    page.drawText(String(txt), { x: xRight - w, y, size, font: thai, color: black })
  }
  const C = (txt, xCenter, y, size = 9) => {
    const w = thai.widthOfTextAtSize(String(txt), size)
    page.drawText(String(txt), { x: xCenter - w / 2, y, size, font: thai, color: black })
  }
  // จำนวนเงิน: "บาท." ชิดเส้นแบ่งสตางค์ (ซ้าย), "00" ชิดเส้นแบ่ง (ขวา) — เส้นแบ่งจริง: คอลัมน์เงิน x475.0, คอลัมน์ภาษี x546.3
  const moneyCell = (amount, satDivX, y, size = 9) => {
    const [intPart] = money(amount).split('.')
    R(`${intPart}.`, satDivX - 0.3, y, size)
    T('00', satDivX + 1.5, y, size)
  }
  const digits = (str, boxes, yBase) => {
    let i = 0
    for (const b of boxes) {
      const step = (b.xs[1] - b.xs[0]) / b.n
      for (let k = 0; k < b.n; k++) {
        const cx = b.xs[0] + (k + 0.5) * step
        const ch = str[i++]
        const w = thai.widthOfTextAtSize(ch, 9)
        page.drawText(ch, { x: cx - w / 2, y: yBase, size: 9, font: thai, color: black })
      }
    }
  }
  // ── ข้อความไทย: เรนเดอร์ผ่าน canvas แล้วฝังเป็นรูป (pdf-lib shape ไทยไม่ได้) ──
  const _imgCache = new Map()
  const embedThai = async (text, sizePt) => {
    const key = `${text}@${sizePt}`
    if (_imgCache.has(key)) return _imgCache.get(key)
    const png = thaiTextPng(text, sizePt)
    const rec = { img: await pdf.embedPng(png.url), png }
    _imgCache.set(key, rec)
    return rec
  }
  // align: 'l'|'c'|'r' อ้างอิง x ; y = baseline (bottom-up)
  const TH = async (text, x, y, sizePt = 9, align = 'l') => {
    const { img, png } = await embedThai(text, sizePt)
    const w = png.wPt, h = png.hPt
    const drawX = align === 'r' ? x - w : align === 'c' ? x - w / 2 : x
    page.drawImage(img, { x: drawX, y: y - (h - png.baselinePt), width: w, height: h })
  }

  // header
  T(bookNo || BOOK_NO, 522, 784)
  T(runNo, 522, 768)
  // payer / payee (ไทย → รูป)
  await TH(PAYER.name, 56, 733, 9)
  await TH(PAYER.addr, 62, 709, 7.5)
  await TH(PAYEE.name, 55, 661, 9)
  await TH(PAYEE.addr, 62, 631, 7.5)
  digits(PAYER.tin, ID_BOXES, 747.5)
  digits(PAYEE.tin, ID_BOXES_2, 679)
  // ภ.ง.ด.53  +  ผู้จ่ายเงิน (1) หัก ณ ที่จ่าย
  const form = pdf.getForm()
  try { form.getCheckBox('chk7').check() } catch (e) { void e }
  try { form.getCheckBox('chk8').check() } catch (e) { void e }
  // income row 5 (ม.3 เตรส — ค่าบริการ)  +  รวม
  C(dateShort, 364.6, 219, 8) // กลางช่อง "วัน เดือน ที่จ่าย" (x326.5-402.7)
  moneyCell(SERVICE_FEE, 475.0, 219)
  moneyCell(tax, 546.3, 219)
  moneyCell(SERVICE_FEE, 475.0, 183.5)
  moneyCell(tax, 546.3, 183.5)
  // วันที่ออกหนังสือรับรอง (ล่างขวา) — กลางแต่ละช่อง date/month/year_pay
  C(String(dd), 353.9, 75, 9)
  await TH(TH_MONTHS[d.getMonth() + 1], 396, 75, 9, 'c')
  C(String(be), 449.7, 75, 9)

  try { form.flatten() } catch (e) { void e }
  // ช่อง total (ตัวอักษรจำนวนเงิน) เป็น text field ว่างที่ flatten ทิ้งพื้นเทาไว้ (เส้นซ้อน) — ลบพื้นเทา แล้ววาดข้อความทับ
  page.drawRectangle({ x: 182, y: page.getHeight() - 685.2, width: 559.5 - 182, height: 685.2 - 664.5, color: rgb(1, 1, 1) })
  await TH(`( ${bahttext(tax)} )`, 371, 162, 9, 'c')
  // แก้เงาซ้อน: pdf-lib flatten() วาดกรอบ checkbox ตาม widget rect เป๊ะ แต่กรอบสี่เหลี่ยมที่พิมพ์ไว้ใน
  // ฟอร์ม RD ต้นฉบับเยื้องจาก widget rect เล็กน้อย (ไม่เท่ากันทุกช่อง วัดจริงทีละช่องด้วย pymupdf) —
  // เห็นเป็นเส้นจางซ้อนที่ช่อง (1)-(6) ที่ไม่ได้ติ๊ก (chk7 ติ๊กแล้วไม่ต้องแก้) ลบเฉพาะส่วนที่ widget
  // โผล่เกินกรอบพิมพ์จริง ไม่แตะกรอบที่พิมพ์ไว้เลย (พิกัด topdown, flip เป็น bottom-up ตอนวาด)
  const pageH = page.getHeight()
  const patchGhost = (bold, ghost) => {
    const [bx0, by0, bx1, by1] = bold
    const [gx0, gy0, gx1, gy1] = ghost
    const eps = 0.01, pad = 0.25, bite = 0.15 // bite = กัดเข้าไปในกรอบพิมพ์เล็กน้อยกันเส้นจางตกค้างที่รอยต่อ
    const wh = (x0, y0t, x1, y1t) => page.drawRectangle({ x: x0, y: pageH - y1t, width: x1 - x0, height: y1t - y0t, color: rgb(1, 1, 1) })
    if (gx1 > bx1 + eps) wh(bx1 - bite, gy0 - pad, gx1 + pad, gy1 + pad) // เกินขวา
    if (gx0 < bx0 - eps) wh(gx0 - pad, gy0 - pad, bx0 + bite, gy1 + pad) // เกินซ้าย
    if (gy0 < by0 - eps) wh(gx0 - pad, gy0 - pad, gx1 + pad, by0 + bite) // เกินบน (topdown เล็ก=สูงกว่า)
    if (gy1 > by1 + eps) wh(gx0 - pad, by1 - bite, gx1 + pad, gy1 + pad) // เกินล่าง
  }
  // [bold, ghost] วัดจริงจาก template ทีละช่อง (chk1..chk6)
  patchGhost([209.3, 228.2, 221.2, 240.1], [209.3, 226.77, 222.0, 240.13])
  patchGhost([287.27, 228.2, 299.17, 240.1], [287.23, 226.77, 300.67, 240.13])
  patchGhost([395.0, 228.2, 406.9, 240.1], [394.67, 227.43, 407.33, 240.13])
  patchGhost([472.1, 228.2, 484.0, 240.1], [471.33, 227.43, 484.03, 240.13])
  patchGhost([209.3, 246.67, 221.2, 258.57], [209.3, 245.43, 222.0, 258.57])
  patchGhost([287.27, 246.63, 299.17, 258.57], [287.23, 245.43, 300.0, 258.57])
  // แถว "ผู้จ่ายเงิน" (2)(3)(4) ที่ไม่ได้ติ๊ก (chk8 ติ๊กแล้วไม่ต้องแก้)
  patchGhost([176.3, 710.56, 187.54, 722.48], [176.3, 709.51, 188.17, 722.01])
  page.drawRectangle({ x: 176.3, y: pageH - 722.5, width: 0.9, height: 722.5 - 709.3, color: rgb(1, 1, 1) }) // เก็บเส้นจางตกค้างซ้ายในกรอบ
  patchGhost([283.3, 710.56, 295.23, 722.49], [282.33, 710.16, 294.75, 722.16])
  patchGhost([393.86, 710.57, 405.79, 722.49], [393.66, 710.82, 405.66, 722.82])
  // ทับปุ่ม "Clear Data" ที่มุมขวาบน (อยู่นอกกรอบเอกสาร)
  page.drawRectangle({ x: 480, y: 812, width: 105, height: 30, color: rgb(1, 1, 1) })

  return pdf.save()
}

const inp = { width: '100%', border: '1px solid var(--payi-border)', borderRadius: 10, padding: '10px 12px', fontSize: 14, background: 'var(--payi-surface)', color: 'var(--payi-text-strong)', boxSizing: 'border-box' }
const lbl = { fontSize: 12, fontWeight: 700, color: 'var(--payi-text-muted)', marginBottom: 6, display: 'block' }

export default function WhtCert() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  const [runNo, setRunNo] = useState('')
  const [dateISO, setDateISO] = useState(today)
  const [bookNo, setBookNo] = useState(BOOK_NO)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const gen = async () => {
    setErr('')
    if (!runNo.trim()) { setErr('กรอกเลขที่'); return }
    if (!dateISO) { setErr('เลือกวันที่'); return }
    setBusy(true)
    try {
      const bytes = await buildPdf({ runNo: runNo.trim(), dateISO, bookNo: bookNo.trim() })
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `หัก ณ ที่จ่าย ${runNo.trim()} (${dateISO}).pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setErr('สร้างไม่สำเร็จ: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const tax = Math.round(SERVICE_FEE * WHT_RATE)

  return (
    <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {err && <div style={{ background: 'var(--payi-danger-bg)', color: 'var(--payi-danger)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>{err}</div>}

      <div style={{ background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 12 }}>
          <div>
            <label style={lbl}>เล่มที่</label>
            <input value={bookNo} onChange={(e) => setBookNo(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={lbl}>เลขที่ *</label>
            <input value={runNo} onChange={(e) => setRunNo(e.target.value)} style={inp} placeholder="เช่น 21" autoFocus />
          </div>
        </div>
        <div>
          <label style={lbl}>วันที่จ่าย *</label>
          <input type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} style={inp} />
          <div style={{ fontSize: 11.5, color: 'var(--payi-text-faint)', marginTop: 5 }}>
            ลงทั้งช่อง "วัน เดือน ที่จ่าย" ของรายการ และช่องวันที่ออกหนังสือรับรอง
          </div>
        </div>

        <button onClick={gen} disabled={busy} style={{
          marginTop: 4, background: 'var(--payi-gradient-primary)', color: '#fff', border: 'none', borderRadius: 10,
          padding: '12px 16px', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: busy ? 0.6 : 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          {busy ? <><Loader2 size={16} className="payi-spin" /> กำลังสร้าง...</> : <><Download size={16} /> สร้าง PDF</>}
        </button>
      </div>

      <div style={{ background: 'var(--payi-surface-muted)', border: '1px solid var(--payi-border)', borderRadius: 12, padding: 16, fontSize: 12.5, color: 'var(--payi-text)', lineHeight: 1.7 }}>
        <b style={{ color: 'var(--payi-text-strong)' }}>คงที่ทุกใบ:</b><br />
        ผู้จ่าย: {PAYER.name} ({PAYER.tin})<br />
        ผู้ถูกหัก: {PAYEE.name} ({PAYEE.tin})<br />
        รายการ: ข้อ 5 ค่าบริการออกของ · ฐาน ฿{SERVICE_FEE.toLocaleString()} · หัก 3% = ฿{tax} · ภ.ง.ด.53 · หัก ณ ที่จ่าย
      </div>
    </div>
  )
}
