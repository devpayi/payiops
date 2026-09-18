import { useEffect, useMemo, useState, useCallback } from 'react'
import { Users, UserPlus, Search, X, ExternalLink, RefreshCw, FilePlus2, Printer } from 'lucide-react'
import KpiCard from '../components/KpiCard'

const API = '/api/sheet-tools?op=hr-people'

const VIEWS = [
  { id: 'employees', label: 'พนักงาน (เดิม)', icon: Users, formLabel: 'ฟอร์มข้อมูลพนักงาน (เดิม)', formUrl: 'https://docs.google.com/forms/d/1hxqaPqkZfiOaR7Hclm5XtBYrZTnS4vHdf7p4KviBVTk/viewform' },
  { id: 'employees_full', label: 'พนักงาน (แบบเต็ม)', icon: Users, formLabel: 'ฟอร์มข้อมูลพนักงาน (แบบเต็ม บนมือถือ)', formUrl: '/employee.html' },
  { id: 'applicants', label: 'ผู้สมัครงาน (แบบสั้น)', icon: UserPlus, formLabel: 'ฟอร์มใบสมัครงาน (แบบสั้น)', formUrl: 'https://docs.google.com/forms/d/1sjhYp5tFwJlvuhpa5yT0DwPOVutZdmxXmBnENiWs_AM/viewform' },
  { id: 'applicants_full', label: 'ผู้สมัครงาน (แบบเต็ม)', icon: FilePlus2, formLabel: 'ฟอร์มใบสมัครงาน (แบบเต็ม บนมือถือ)', formUrl: '/apply.html' },
]

// ตาราง employees_full/applicants_full มีคอลัมน์เยอะมาก (50-65 คอลัมน์) โชว์ทุกคอลัมน์ในตาราง
// อ่านไม่ไหว — ตารางเลยโชว์แค่สรุปคร่าวๆ ตามนี้ (คลิกแถวหรือกด "ดูทั้งหมด" เพื่อเปิด Drawer ที่มี
// ทุกคอลัมน์จริง). view อื่น (employees/applicants จาก Google Form) header น้อยอยู่แล้ว โชว์ครบปกติ
const SUMMARY_COLUMNS = {
  employees_full: ['ประทับเวลา', 'ชื่อ-นามสกุล', 'ตำแหน่งงาน', 'โทรศัพท์มือถือ', 'วันที่เริ่มงาน'],
  applicants_full: ['ประทับเวลา', 'ชื่อ-นามสกุล', 'ตำแหน่งงานที่สมัคร', 'โทรศัพท์มือถือ'],
}

// ประวัติการศึกษา/ประวัติการทำงานเก็บเป็น JSON array ต่อแถว (มาจาก public/apply.html) —
// แปลงเป็นข้อความอ่านง่ายแทนโชว์ JSON ดิบ
function parseJsonRows(value) {
  try {
    const arr = JSON.parse(value)
    if (Array.isArray(arr) && arr.length && arr.every((x) => x && typeof x === 'object')) return arr
  } catch { /* not JSON, ignore */ }
  return null
}
function JsonRowsView({ value }) {
  const rows = parseJsonRows(value)
  if (!rows) return <LinkOrText value={value} />
  if (!rows.length) return <span style={{ color: 'var(--payi-text-faint)' }}>—</span>
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {rows.map((r, i) => (
        <li key={i} style={{ marginBottom: 2 }}>{Object.values(r).filter(Boolean).join(' · ') || '—'}</li>
      ))}
    </ul>
  )
}

// ป้ายแสดงผลสวยกว่าชื่อ header ดิบจากฟอร์ม — "ประทับเวลา" คือคอลัมน์ที่ Google Forms
// สร้างให้อัตโนมัติ แก้ชื่อในฟอร์มไม่ได้ (ไม่ใช่คำถามจริง) เลยแมปตรงนี้แทน
const HEADER_LABELS = { 'ประทับเวลา': 'วันที่ส่งฟอร์ม' }
const displayLabel = (h) => HEADER_LABELS[h] || h

const isUrl = (v) => /^https?:\/\//i.test(String(v || '').trim())
// คอลัมน์ที่เป็นชื่อคน/หัวข้อหลัก — เดาจากชื่อ header เพื่อโชว์เป็นหัวแถวในตาราง
const nameHint = (h) => /ชื่อ|name|พนักงาน|ผู้สมัคร/i.test(h) && !/บริษัท|เล่น|ผู้ติดต่อ|ฉุกเฉิน|company/i.test(h)

// ==================== PDF: แบบฟอร์มล็อคแพตเทิร์นตายตัว ====================
// บอส 2026-09-18 ส่งไฟล์ใบสมัครงานราชการ (3 หน้า, ช่องกรอก/checkbox ตายตัว) มาขอให้ทำ PDF
// หน้าตาแบบนี้เป๊ะๆ — คนละแนวกับ PROFILE_SECTIONS เดิม (ที่จัดกลุ่มตามข้อมูลที่มี) ที่นี่กลับกัน:
// เค้าโครง/ลำดับ/labeled blank ทุกอันตายตัวตามต้นฉบับเสมอ ไม่ว่าข้อมูลจะมีหรือไม่ — ช่องไหน
// ไม่มีข้อมูลก็ปล่อยว่างไว้ (ไม่ซ่อนช่อง ไม่ยุบเลย์เอาต์) ตรงตามที่ขอ "อันไหนไม่กรอกก็ว่างไว้"
// การ map มาจากฟิลด์ของเราไม่ตรง 1:1 กับต้นฉบับเป๊ะทุกจุด (เช่น ต้นฉบับแยกที่อยู่เป็นเลขที่/หมู่ที่/
// ถนนคนละช่อง แต่ของเราเก็บที่อยู่เป็นข้อความก้อนเดียว) — จุดที่ map ไม่ตรงคอมเมนต์ไว้ในโค้ดแต่ละจุด
const V = (v) => (v == null ? '' : String(v).trim())
function Blank({ value, minWidth = 60, grow = 1 }) {
  return (
    <span style={{ display: 'inline-block', borderBottom: '1px dotted #333', minWidth, flex: grow, padding: '0 4px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {V(value) || ' '}
    </span>
  )
}
function Chk({ label, checked }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 16 }}><span style={{ fontFamily: 'monospace', fontSize: 14 }}>{checked ? '☑' : '☐'}</span>{label}</span>
}
function Line({ children }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 6, marginBottom: 10, fontSize: 12.5 }}>{children}</div>
}
// ตารางแถวคงที่ (ไม่ยุบตามจำนวนข้อมูลจริง) — เติมแถวว่างจนครบ minRows เสมอ ตามต้นฉบับ
function FixedTable({ cols, data, minRows }) {
  const rows = [...data]
  while (rows.length < minRows) rows.push({})
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginBottom: 14 }}>
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.key} style={{ border: '1px solid #333', padding: '4px 6px', background: '#f1f5f9', fontWeight: 700 }}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, Math.max(minRows, rows.length)).map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={c.key} style={{ border: '1px solid #333', padding: '4px 6px', height: 20 }}>{V(r[c.key])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function LockedApplicationForm({ row }) {
  const fullName = [row['คำนำหน้า'], row['ชื่อ-นามสกุล']].filter(Boolean).join('')
  // เพศไม่ได้เก็บเป็นฟิลด์ตรงๆ ในระบบเรา — เดาจากคำนำหน้าแทน (นาย=ชาย, นาง/นางสาว=หญิง)
  const genderMale = row['คำนำหน้า'] === 'นาย'
  const genderFemale = row['คำนำหน้า'] === 'นาง' || row['คำนำหน้า'] === 'นางสาว'
  // residence_type ตัวเลือกของเรา (บ้านตัวเอง/บ้านญาติ/ห้องเช่า-บ้านเช่า/อื่นๆ) ไม่ตรง 1:1 กับ
  // ต้นฉบับ (อาศัยกับครอบครัว/บ้านตัวเอง/บ้านเช่า/หอพัก) — map เท่าที่ใกล้เคียง ที่เหลือปล่อยว่าง
  const residence = row['ประเภทที่อยู่อาศัย']
  // สถานะทางการทหารของเรา (ได้รับการยกเว้น/ศึกษาวิชาทหาร (รด.)/ผ่านการเกณฑ์ทหารแล้ว/ไม่เกี่ยวข้อง)
  // ก็ไม่ตรง 1:1 กับต้นฉบับ (ได้รับการยกเว้น/ปลดเป็นทหารกองหนุน/ยังไม่ได้รับการเกณฑ์) — map เท่าที่ใกล้เคียง
  const military = row['สถานะทางการทหาร']
  const marital = row['สถานภาพครอบครัว']
  const idCard = row['เลขบัตรประชาชน']
  // ผู้สมัคร (แบบเต็ม) ใช้ reference_*, พนักงาน (แบบเต็ม) ใช้ emergency_contact_* — โชว์อันที่มีข้อมูล
  const contactName = row['บุคคลที่ติดต่อได้กรณีฉุกเฉิน (ชื่อ)'] || row['บุคคลอ้างอิง (ชื่อ/ความสัมพันธ์)']
  const contactRelation = row['ความสัมพันธ์']
  const contactOccupation = row['บุคคลอ้างอิง (อาชีพ)']
  const contactPhone = row['เบอร์โทรฉุกเฉิน'] || row['บุคคลอ้างอิง (เบอร์โทร)']

  const eduRows = (parseJsonRows(row['ประวัติการศึกษา']) || []).map((e) => ({
    from: '', to: V(e.year), school: V(e.school), major: V(e.major), cert: V(e.level),
  }))
  const workRows = (parseJsonRows(row['ประวัติการทำงาน']) || []).map((w) => ({
    from: V(w.from), to: V(w.to), org: V(w.company), position: V(w.position), salary: V(w.salary), reason: V(w.reason_left),
  }))
  const programs = (row['โปรแกรมที่ใช้ได้'] || '').split(',').map((s) => s.trim()).filter(Boolean)
  const compLevel = row['ความสามารถใช้คอมพิวเตอร์']
  const compRows = programs.map((p) => ({ program: p, level: compLevel }))
  const langRows = [
    row['ภาษาอังกฤษ (พูด)'] && { lang: 'อังกฤษ (พูด)', level: row['ภาษาอังกฤษ (พูด)'] },
    row['ภาษาอังกฤษ (อ่าน)'] && { lang: 'อังกฤษ (อ่าน)', level: row['ภาษาอังกฤษ (อ่าน)'] },
    row['ภาษาอังกฤษ (เขียน)'] && { lang: 'อังกฤษ (เขียน)', level: row['ภาษาอังกฤษ (เขียน)'] },
    row['ภาษาอื่นๆ'] && { lang: row['ภาษาอื่นๆ'], level: '' },
  ].filter(Boolean)
  const otherAbility = row['ความสามารถใช้เครื่องใช้สำนักงาน']
  const moreInfoLines = [
    row['กิจกรรม/รางวัลระหว่างการศึกษา'] && `กิจกรรม/รางวัลระหว่างการศึกษา: ${row['กิจกรรม/รางวัลระหว่างการศึกษา']}`,
    row['สาขาที่ชอบเป็นพิเศษ'] && `สาขาที่ชอบเป็นพิเศษ: ${row['สาขาที่ชอบเป็นพิเศษ']}`,
    row['ประวัติอาชญากรรม'] && `ประวัติอาชญากรรม: ${row['ประวัติอาชญากรรม']}`,
    row['โรคประจำตัว/สุขภาพ'] && `โรคประจำตัว/สุขภาพ: ${row['โรคประจำตัว/สุขภาพ']}`,
  ].filter(Boolean)

  const wrap = { fontFamily: '-apple-system, "Noto Sans Thai", Arial, sans-serif', color: '#111', fontSize: 12.5, lineHeight: 1.7 }
  const pageBreak = { breakBefore: 'page' }

  return (
    <div style={wrap}>
      {/* หน้า 1 — ประวัติส่วนตัว */}
      <div style={{ textAlign: 'right', fontSize: 11 }}>ใบสมัครเลขที่ <Blank value="" minWidth={80} grow={0} /></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '8px 0 16px' }}>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>ใบสมัครงาน</div>
          <div style={{ fontSize: 11, color: '#555' }}>PAYI — เอกสารประวัติบุคคล</div>
        </div>
        <div style={{ width: 90, height: 110, border: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#999', flexShrink: 0 }}>รูปถ่าย</div>
      </div>

      <div style={{ fontWeight: 700, marginBottom: 8 }}>1. ประวัติส่วนตัว</div>
      <Line><span>ชื่อ - สกุล :</span><Blank value={fullName} grow={1} /></Line>
      <Line><span>เลขบัตรประจำตัวประชาชน</span><Blank value={idCard} grow={1} /></Line>
      {/* ต้นฉบับแยกเลขที่/หมู่ที่/ถนน/ตำบล คนละช่อง — ของเราเก็บที่อยู่เป็นก้อนเดียว ใส่รวมไว้ที่ "เลขที่" */}
      <Line><span>ที่อยู่ปัจจุบันเลขที่</span><Blank value={row['ที่อยู่ปัจจุบัน']} grow={2} /><span>ตำบล/แขวง</span><Blank value={row['ตำบล/แขวง']} /></Line>
      <Line><span>อำเภอ/เขต</span><Blank value={row['อำเภอ/เขต']} /><span>จังหวัด</span><Blank value={row['จังหวัด']} /><span>รหัสไปรษณีย์</span><Blank value={row['รหัสไปรษณีย์']} minWidth={50} /></Line>
      <Line>
        <Chk label="อาศัยกับครอบครัว" checked={residence === 'บ้านญาติ'} />
        <Chk label="บ้านตัวเอง" checked={residence === 'บ้านตัวเอง'} />
        <Chk label="บ้านเช่า" checked={residence === 'ห้องเช่า/บ้านเช่า'} />
        <Chk label="หอพัก" checked={false} />
      </Line>
      <Line><span>โทรศัพท์</span><Blank value={row['โทรศัพท์บ้าน']} /><span>มือถือ</span><Blank value={row['โทรศัพท์มือถือ']} /></Line>
      <Line><span>E-mail</span><Blank value={row['Email']} grow={1} /></Line>
      <Line><span>วัน เดือน ปีเกิด</span><Blank value={row['วันเดือนปีเกิด']} /><span>อายุ</span><Blank value={row['อายุ']} minWidth={40} grow={0} /><span>ปี เชื้อชาติ</span><Blank value={row['เชื้อชาติ']} /></Line>
      <Line><span>สัญชาติ</span><Blank value={row['สัญชาติ']} /><span>ศาสนา</span><Blank value={row['ศาสนา']} /></Line>
      <Line><span>บัตรประชาชนเลขที่</span><Blank value={idCard} /><span>บัตรหมดอายุ</span><Blank value="" /></Line>
      <Line><span>ส่วนสูง</span><Blank value={row['ส่วนสูง (ซม.)']} minWidth={40} grow={0} /><span>ซม.</span><span>น้ำหนัก</span><Blank value={row['น้ำหนัก (กก.)']} minWidth={40} grow={0} /><span>กก.</span></Line>

      <Line>
        <span style={{ minWidth: 90 }}>ภาวะทางทหาร</span>
        <Chk label="ได้รับการยกเว้น" checked={military === 'ได้รับการยกเว้น'} />
        <Chk label="ปลดเป็นทหารกองหนุน" checked={military === 'ผ่านการเกณฑ์ทหารแล้ว'} />
        <Chk label="ยังไม่ได้รับการเกณฑ์" checked={military === 'ศึกษาวิชาทหาร (รด.)'} />
      </Line>
      <Line>
        <span style={{ minWidth: 90 }}>สถานภาพ</span>
        <Chk label="โสด" checked={marital === 'โสด'} />
        <Chk label="แต่งงาน" checked={marital === 'แต่งงาน'} />
        <Chk label="หม้าย" checked={false} />
        <Chk label="แยกกัน" checked={marital === 'แยกกันอยู่'} />
      </Line>
      <Line>
        <span style={{ minWidth: 90 }}>เพศ</span>
        <Chk label="ชาย" checked={genderMale} />
        <Chk label="หญิง" checked={genderFemale} />
      </Line>

      <div style={{ fontWeight: 700, margin: '14px 0 8px' }}>บุคคลที่สามารถติดต่อได้ (กรณีฉุกเฉิน)</div>
      <Line><span>ชื่อ - สกุล</span><Blank value={contactName} grow={2} /><span>อาชีพ</span><Blank value={contactOccupation} /></Line>
      <Line><span>สถานที่ทำงาน</span><Blank value="" grow={2} /><span>เกี่ยวข้องเป็น</span><Blank value={contactRelation} /></Line>
      <Line><span>โทรศัพท์ (มือถือ)</span><Blank value={contactPhone} grow={1} /></Line>

      {/* หน้า 2 — การศึกษา/ประสบการณ์ทำงาน/ทักษะ */}
      <div style={pageBreak}>
        <div style={{ fontWeight: 700, marginBottom: 6, marginTop: 24 }}>2. ข้อมูลการศึกษา</div>
        <FixedTable minRows={5} data={eduRows} cols={[
          { key: 'from', label: 'ปี พ.ศ. (จาก)' }, { key: 'to', label: 'ปี พ.ศ. (ถึง)' },
          { key: 'school', label: 'สถาบันการศึกษา' }, { key: 'major', label: 'สาขาวิชา' },
          { key: 'cert', label: 'ประกาศนียบัตร/ปริญญาบัตร' },
        ]} />

        <div style={{ fontWeight: 700, marginBottom: 6 }}>3. ข้อมูลการทำงานและประสบการณ์ทำงาน</div>
        <FixedTable minRows={5} data={workRows} cols={[
          { key: 'from', label: 'ปี พ.ศ. (จาก)' }, { key: 'to', label: 'ปี พ.ศ. (ถึง)' },
          { key: 'org', label: 'ชื่อและที่อยู่ของหน่วยงาน' }, { key: 'position', label: 'ตำแหน่งและหน้าที่โดยย่อ' },
          { key: 'salary', label: 'เงินเดือน' }, { key: 'reason', label: 'สาเหตุที่ออกจากงาน' },
        ]} />

        <div style={{ fontWeight: 700, marginBottom: 6 }}>4. ความสามารถทางด้านคอมพิวเตอร์</div>
        <FixedTable minRows={4} data={compRows} cols={[
          { key: 'program', label: 'โปรแกรม' }, { key: 'level', label: 'ระดับความสามารถ' },
        ]} />

        <div style={{ fontWeight: 700, marginBottom: 6 }}>5. ความสามารถทางด้านภาษาต่างประเทศ</div>
        <FixedTable minRows={4} data={langRows.map((l) => ({ lang: l.lang, level: l.level }))} cols={[
          { key: 'lang', label: 'ภาษา' }, { key: 'level', label: 'ระดับความสามารถ' },
        ]} />
      </div>

      {/* หน้า 3 — ความสามารถอื่นๆ/ข้อมูลเพิ่มเติม/ลายเซ็น */}
      <div style={pageBreak}>
        <div style={{ fontWeight: 700, marginBottom: 6, marginTop: 24 }}>6. ความสามารถด้านอื่นๆ</div>
        {/* ไม่มีฟิลด์ตรงกับขับรถ/มอไซค์/พิมพ์ดีดในระบบเรา — checkbox กลุ่มนี้ไม่ติ๊กเสมอ (ไม่มีข้อมูล) */}
        <Line><Chk label="สามารถขับขี่รถยนต์" checked={false} /><Chk label="มีพาหนะเป็นของตนเอง" checked={false} /></Line>
        <Line><Chk label="สามารถขับขี่รถจักรยานยนต์" checked={false} /></Line>
        <Line><span>ความสามารถอื่นๆ (โปรดระบุ)</span><Blank value={otherAbility} grow={1} /></Line>

        <div style={{ fontWeight: 700, margin: '14px 0 6px' }}>7. ข้อมูลเพิ่มเติม (เช่น ประวัติการฝึกอบรม/คุณสมบัติอื่นๆ ที่เกี่ยวข้องกับตำแหน่งงาน)</div>
        {moreInfoLines.length ? moreInfoLines.map((t, i) => (
          <div key={i} style={{ borderBottom: '1px dotted #333', padding: '3px 0', minHeight: 18 }}>{t}</div>
        )) : [0, 1, 2].map((i) => <div key={i} style={{ borderBottom: '1px dotted #333', padding: '3px 0', minHeight: 18 }}>&nbsp;</div>)}

        <div style={{ marginTop: 28, fontSize: 12 }}>
          ข้าพเจ้าขอรับรองว่าข้อความข้างต้นเป็นความจริงทุกประการ หากปรากฏในภายหลังว่าข้อความ
          ที่ข้าพเจ้าได้กล่าวข้างต้นเป็นเท็จ บริษัทอาจพิจารณาเลิกจ้างข้าพเจ้าได้ โดยข้าพเจ้าจะไม่เรียกร้อง
          ค่าชดเชยหรือค่าเสียหายใดๆ ทั้งสิ้น
        </div>
        <div style={{ marginTop: 40, textAlign: 'center', fontSize: 12 }}>
          <div>ลายมือชื่อผู้สมัคร</div>
          <div style={{ marginTop: 28 }}>.......................................................</div>
          <div>({fullName || '......................................................'})</div>
          <div style={{ marginTop: 6 }}>........... / ............... / ...........</div>
        </div>
      </div>
    </div>
  )
}

function LinkOrText({ value }) {
  if (isUrl(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--payi-mint-strong)', fontWeight: 600 }}>
        <ExternalLink size={13} /> เปิดไฟล์
      </a>
    )
  }
  return <>{value || <span style={{ color: 'var(--payi-text-faint)' }}>—</span>}</>
}

// พิมพ์เฉพาะเนื้อหา drawer (ซ่อนทุกอย่างอื่นตอนสั่งพิมพ์) — ไม่ต้องใช้ library, ใช้ browser
// print เดิม เหมือน public/apply.html แค่ scope ด้วย class .hr-print-area แทน
function DetailDrawer({ row, headers, onClose }) {
  if (!row) return null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .hr-print-area, .hr-print-area * { visibility: visible !important; }
          .hr-print-area { position: fixed; inset: 0; width: 100%; height: auto !important; overflow: visible !important; padding: 20px !important; }
          .hr-no-print { display: none !important; }
          .hr-print-only { display: block !important; }
        }
        .hr-print-only { display: none; }
      `}</style>
      <div className="app-side-drawer hr-print-area" onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--payi-surface)', width: 'min(460px,100vw)', height: '100%', overflowY: 'auto', padding: 24, boxSizing: 'border-box' }}>
        <div className="hr-no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <strong style={{ fontSize: 16, color: 'var(--payi-text-strong)' }}>รายละเอียด</strong>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => window.print()} title="สร้าง PDF / พิมพ์"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--payi-text-strong)' }}>
              <Printer size={14} /> สร้าง PDF
            </button>
            <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--payi-text-muted)' }}><X size={20} /></button>
          </div>
        </div>
        <div className="hr-no-print" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {headers.map((h) => (
            <div key={h}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--payi-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 3 }}>{displayLabel(h)}</div>
              <div style={{ fontSize: 14, color: 'var(--payi-text-strong)', wordBreak: 'break-word' }}><JsonRowsView value={row[h]} /></div>
            </div>
          ))}
        </div>
        <div className="hr-print-only">
          <LockedApplicationForm row={row} />
        </div>
      </div>
    </div>
  )
}

function SetupHint() {
  return (
    <div className="payi-glass-card" style={{ padding: 24, lineHeight: 1.7, fontSize: 14, color: 'var(--payi-text-strong)' }}>
      <strong style={{ fontSize: 15 }}>ยังไม่ได้ตั้งค่า HR spreadsheet</strong>
      <ol style={{ paddingLeft: 20, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li>สร้าง Google Sheet ใหม่ (แยกจาก mona-ops-db) — <b>อย่าเปิดแชร์แบบลิงก์</b> เพราะมีเลขบัตร ปชช/ทะเบียนบ้าน</li>
        <li>แชร์ชีตให้ service account (อีเมล <code>...iam.gserviceaccount.com</code>) สิทธิ์ผู้อ่าน</li>
        <li>สร้าง Google Form 2 อัน: ข้อมูลพนักงาน + ใบสมัครงาน ผูกคำตอบเข้าชีตนี้</li>
        <li>เปลี่ยนชื่อแท็บคำตอบเป็น <code>employees</code> และ <code>applicants</code> (หรือตั้ง env <code>HR_EMP_TAB</code>/<code>HR_APPLICANT_TAB</code>)</li>
        <li>ตั้ง env <code>HR_SHEET_ID</code> = id จาก URL ของชีต แล้ว redeploy</li>
      </ol>
      <p style={{ marginTop: 12, color: 'var(--payi-text-muted)' }}>รูปบัตร/ทะเบียนบ้านที่อัปโหลดผ่านฟอร์มจะเก็บใน Google Drive ของเจ้าของฟอร์ม — หน้านี้แสดงเป็นลิงก์ให้กดเปิด</p>
    </div>
  )
}

export default function HRPeople() {
  const [view, setView] = useState('employees')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)

  const load = useCallback(() => {
    setLoading(true); setErr('')
    fetch(`${API}&view=${view}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.success && d.error) setErr(d.error)
        setData(d)
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [view])

  useEffect(() => { load() }, [load])

  const activeView = VIEWS.find((v) => v.id === view) || VIEWS[0]
  const headers = data.headers || []
  const rows = data.rows || []
  const nameCol = useMemo(() => headers.find(nameHint) || headers[1] || headers[0], [headers])
  // แบบเต็ม (employees_full/applicants_full) คอลัมน์เยอะเกินโชว์ในตารางไหว — โชว์แค่สรุป
  // แล้วให้กด "ดูทั้งหมด" เปิด Drawer แทน (Drawer ยังโชว์ headers ครบทุกคอลัมน์เหมือนเดิม)
  const summaryDef = SUMMARY_COLUMNS[view]
  const tableCols = summaryDef ? summaryDef.filter((h) => headers.includes(h)) : headers
  const isSummaryView = !!summaryDef

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return rows
    return rows.filter((row) => headers.some((h) => String(row[h] || '').toLowerCase().includes(t)))
  }, [rows, headers, q])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => { setView(v.id); setQ('') }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600,
              border: '1px solid var(--payi-border)',
              background: view === v.id ? 'var(--payi-mint)' : 'var(--payi-surface)',
              color: view === v.id ? '#fff' : 'var(--payi-text-strong)',
            }}>
            <v.icon size={15} /> {v.label}
          </button>
        ))}
        <button onClick={load} title="โหลดใหม่"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', color: 'var(--payi-text-muted)' }}>
          <RefreshCw size={14} />
        </button>
        <a href={activeView.formUrl} target="_blank" rel="noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600, border: 'none', background: 'var(--payi-gradient-primary)', color: '#fff', textDecoration: 'none', marginLeft: 'auto' }}>
          <FilePlus2 size={15} /> เปิด{activeView.formLabel}
        </a>
      </div>
      <p style={{ margin: '-8px 0 0', fontSize: 12, color: 'var(--payi-text-faint)' }}>
        ส่งลิงก์นี้ให้พนักงาน/ผู้สมัครกรอกได้เลย: <a href={activeView.formUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--payi-mint-strong)' }}>{activeView.formUrl}</a>
      </p>

      {data.configured === false ? (
        <SetupHint />
      ) : (
        <>
          <div className="app-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            <KpiCard title={VIEWS.find((v) => v.id === view).label} value={loading ? '…' : rows.length} subtitle="รายการทั้งหมด" icon={Users} />
            <KpiCard title="แสดงอยู่" value={loading ? '…' : filtered.length} subtitle={q ? `กรอง: "${q}"` : 'ไม่ได้กรอง'} icon={Search} />
          </div>

          <div style={{ position: 'relative', maxWidth: 340 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--payi-text-faint)' }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา ชื่อ / เบอร์ / ที่อยู่ ..."
              style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 10, border: '1px solid var(--payi-border)', fontSize: 14, background: 'var(--payi-surface)', color: 'var(--payi-text-strong)', boxSizing: 'border-box' }} />
          </div>

          {err && <div style={{ color: 'var(--payi-danger)', fontSize: 13 }}>{err}</div>}

          {isSummaryView && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--payi-text-faint)' }}>
              โชว์คร่าวๆ {tableCols.length} คอลัมน์ — คลิกแถวหรือกด "ดูทั้งหมด" เพื่อดูข้อมูลทุกช่องจริงๆ
            </p>
          )}
          <div className="payi-glass-card" style={{ padding: 0, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720, fontSize: 13 }}>
              <thead>
                <tr>
                  {tableCols.map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--payi-border)', color: 'var(--payi-text-muted)', fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.03em' }}>{displayLabel(h)}</th>
                  ))}
                  {isSummaryView && <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--payi-border)' }} />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.__row} onClick={() => setSelected(row)}
                    style={{ cursor: 'pointer', borderBottom: '1px solid var(--payi-border)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--payi-surface-muted)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    {tableCols.map((h) => (
                      <td key={h} style={{ padding: '9px 12px', color: 'var(--payi-text-strong)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: h === nameCol ? 700 : 400 }}>
                        {parseJsonRows(row[h])
                          ? `${parseJsonRows(row[h]).length} รายการ (คลิกดูรายละเอียด)`
                          : isUrl(row[h]) ? <LinkOrText value={row[h]} /> : (row[h] || '—')}
                      </td>
                    ))}
                    {isSummaryView && (
                      <td style={{ padding: '9px 12px' }}>
                        <button onClick={(e) => { e.stopPropagation(); setSelected(row) }}
                          style={{ border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--payi-mint-strong)', whiteSpace: 'nowrap' }}>
                          ดูทั้งหมด
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {!loading && !filtered.length && (
                  <tr><td colSpan={Math.max(tableCols.length, 1)} style={{ padding: 24, textAlign: 'center', color: 'var(--payi-text-muted)' }}>ไม่มีข้อมูล</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selected && <DetailDrawer row={selected} headers={headers} onClose={() => setSelected(null)} />}
    </div>
  )
}
