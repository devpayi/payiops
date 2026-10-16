import {legacyTikTokSales} from '../../../shared/marketingReadModels.js'

const money=value=>value===null?'ยังไม่มีข้อมูล':Number(value).toLocaleString('th-TH',{style:'currency',currency:'THB'})
export default function TikTokSalesChannels({month,business,legacyInputs=null}) {
  const legacy=legacyInputs ? legacyTikTokSales(legacyInputs,month,business) : null
  return <section className="mm-tiktok" aria-labelledby="mm-tt-title">
    <div className="mm-section-title"><div><h2 id="mm-tt-title">ช่องทางขาย TikTok</h2><p>ยอดขายรายเดือน · แยกจากค่าโฆษณา</p></div><span className="mm-badge">อ่านอย่างเดียว</span></div>
    <div className="mm-empty"><strong>รอรายงาน TikTok ของเดือนนี้</strong><p>เมื่อเข้าบัญชีได้ จะตรวจรูปแบบไฟล์และนิยามยอดขายก่อนนำเข้าข้อมูลจริง</p></div>
    <div className="mm-axis-grid">
      <section className="mm-panel"><h3>ที่มาของยอดขาย</h3><p>Seller / Affiliate</p><div className="mm-axis-placeholder">ยังไม่มีรายงาน · ไม่แทนด้วยศูนย์</div></section>
      <section className="mm-panel"><h3>รูปแบบคอนเทนต์</h3><p>Live / Video Clip / Product Card</p><div className="mm-axis-placeholder">ยังไม่มีรายงาน · ไม่แทนด้วยศูนย์</div></section>
    </div>
    <p className="mm-note">Affiliate อาจมาจาก Live หรือ Video ได้ จึงแสดงเป็นสองมุมและไม่บวกข้ามกัน</p>
    <details className="mm-panel" open={Boolean(legacy)}><summary>ข้อมูลที่กรอกไว้เดิม</summary><p className="mm-note">ยังไม่ยืนยันนิยามกับรายงานใหม่ ไม่คำนวณ “อื่น ๆ” เพิ่มและไม่รวมกราฟข้ามมิติ</p>
      {!legacy ? <p>หน้าตัวอย่างนี้ยังไม่ได้อ่านข้อมูลจากชีตเดิม</p> : <><p>GMV ที่กรอกไว้: <strong>{money(legacy.gmv.value)}</strong>{legacy.gmv.status==='conflict'?' · พบข้อมูลซ้ำ ต้องตรวจสอบ':''}</p><div className="mm-table-wrap"><table><thead><tr><th>รายการเดิม</th><th>ยอดที่เก็บไว้</th><th>สถานะ</th></tr></thead><tbody>{legacy.channels.map(row=><tr key={row.metric}><td>{{affiliate:'Affiliate',live:'Live',vdo:'Video',other:'อื่น ๆ'}[row.metric]}</td><td>{money(row.value)}</td><td>{{present:'มีข้อมูล',absent:'ไม่มีข้อมูล',invalid:'รูปแบบผิด',conflict:'ข้อมูลซ้ำ'}[row.status]}</td></tr>)}</tbody></table></div></>}
    </details>
  </section>
}
