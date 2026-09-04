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

async function buildPdf({ runNo, dateISO, bookNo }) {
  const [tplBytes, fontBytes] = await Promise.all([
    fetch(TEMPLATE_URL).then((r) => r.arrayBuffer()),
    fetch(FONT_URL).then((r) => r.arrayBuffer()),
  ])
  const pdf = await PDFDocument.load(tplBytes)
  pdf.registerFontkit(fontkit)
  const thai = await pdf.embedFont(fontBytes, { subset: true })
  const page = pdf.getPage(0)
  const black = rgb(0, 0, 0)

  const d = new Date(dateISO + 'T00:00:00')
  const be = d.getFullYear() + 543
  const dd = d.getDate()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dateShort = `${dd}/${mm}/${be}`
  const tax = Math.round(SERVICE_FEE * WHT_RATE * 100) / 100

  const T = (txt, x, y, size = 9) => page.drawText(String(txt), { x, y, size, font: thai, color: black })
  const R = (txt, xRight, y, size = 9) => {
    const w = thai.widthOfTextAtSize(String(txt), size)
    page.drawText(String(txt), { x: xRight - w, y, size, font: thai, color: black })
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

  // header
  T(bookNo || BOOK_NO, 522, 784)
  T(runNo, 522, 768)
  // payer / payee
  T(PAYER.name, 56, 733, 9)
  T(PAYER.addr, 62, 709, 7.5)
  T(PAYEE.name, 55, 661, 9)
  T(PAYEE.addr, 62, 631, 7.5)
  digits(PAYER.tin, ID_BOXES, 747.5)
  digits(PAYEE.tin, ID_BOXES_2, 679)
  // ภ.ง.ด.53  +  ผู้จ่ายเงิน (1) หัก ณ ที่จ่าย
  const form = pdf.getForm()
  try { form.getCheckBox('chk7').check() } catch (e) { void e }
  try { form.getCheckBox('chk8').check() } catch (e) { void e }
  // income row 5 (ม.3 เตรส — ค่าบริการ)  +  รวม
  T(dateShort, 330, 219, 8)
  R(money(SERVICE_FEE), 487, 219)
  R(money(tax), 559, 219)
  R(money(SERVICE_FEE), 487, 183.5)
  R(money(tax), 559, 183.5)
  // ตัวอักษร
  T(`( ${bahttext(tax)} )`, 190, 162, 10)
  // วันที่ออกหนังสือรับรอง (ล่างขวา)
  T(String(dd), 347, 75, 9)
  T(TH_MONTHS[d.getMonth() + 1], 370, 75, 9)
  T(String(be), 432, 75, 9)

  try { form.flatten() } catch (e) { void e }
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
