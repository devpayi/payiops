import {useState} from 'react'
import {adProductKey,availableAdMappingSources} from '../../../shared/adProductMappings.js'

export default function AdProductMappingEditor({products,mappingState,initialKeys=[],onClose,onSaved}) {
  const [selected,setSelected]=useState(initialKeys)
  const [query,setQuery]=useState('')
  const [familyQuery,setFamilyQuery]=useState('')
  const [familyKey,setFamilyKey]=useState('')
  const [error,setError]=useState('')
  // Preserve the revision the user opened, even if another window refreshes while editing.
  const [openedMappings,setOpenedMappings]=useState(mappingState.data?.mappings||[])
  const families=mappingState.data?.families||[]
  const links=new Map(openedMappings.map(mapping=>[mapping.sourceKey,mapping]))
  const businesses=new Set(products.filter(product=>selected.includes(adProductKey(product))).map(product=>product.business))
  const choices=families.filter(family=>(businesses.size===0||businesses.has(family.business))&&`${family.name} ${family.business}`.toLowerCase().includes(familyQuery.trim().toLowerCase()))
  const visible=availableAdMappingSources(products,openedMappings,families,initialKeys,query)
  async function save(target) {
    setError('')
    try{
      await mappingState.save({id:crypto.randomUUID(),familyKey:target,items:selected.map(sourceKey=>({sourceKey,expectedRevision:links.get(sourceKey)?.revision||null}))})
      onSaved()
    }catch(error){setError(error.message)}
  }
  async function reload() {
    try{const data=await mappingState.refresh();setOpenedMappings(data.mappings);setSelected([]);setFamilyKey('');setError('')}
    catch(error){setError(error.message)}
  }
  return <section className="ad-map-editor" aria-label="Map รายงานเข้ากลุ่มสินค้า">
    <div className="mm-section-title"><div><h2>Map เข้าสินค้าเดียวกัน</h2><p>เลือกชื่อสินค้าจากรายงาน แล้วเลือกกลุ่มสินค้าปลายทาง · ใช้กับเดือนถัดไปด้วย</p></div><button onClick={onClose} disabled={mappingState.saving}>ปิด</button></div>
    <fieldset disabled={mappingState.saving} className="ad-map-fields"><div><label className="ad-map-search">ค้นหารายการต้นทาง<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="ชื่อสินค้า / Product ID / แพลตฟอร์ม"/></label><div className="ad-map-list">
      {visible.map(product=>{
        const key=adProductKey(product),link=links.get(key),family=families.find(family=>family.key===link?.familyKey)
        return <label className="ad-map-source" key={key}><input type="checkbox" checked={selected.includes(key)} onChange={event=>setSelected(previous=>event.target.checked?[...previous,key]:previous.filter(value=>value!==key))}/><span>{product.name}<small>{product.platform} · {product.business} · ID {product.itemId}{family?` · Map: ${family.name}`:''}</small></span></label>
      })}{!visible.length&&<p>{query.trim()?'ไม่พบรายการตามคำค้น':'ไม่มีสินค้าที่ยังไม่ได้ Map'}</p>}
    </div></div><div className="ad-map-target"><strong>เลือกแล้ว {selected.length} รายการ</strong><label>ค้นหากลุ่มสินค้า<input value={familyQuery} onChange={event=>setFamilyQuery(event.target.value)} placeholder="เช่น ถุงเท้าเจล 2in1"/></label><label>รวมเข้าสินค้า<select value={familyKey} onChange={event=>setFamilyKey(event.target.value)}><option value="">เลือกกลุ่มสินค้า</option>{choices.map(family=><option key={family.key} value={family.key}>{family.name} · {family.business}</option>)}</select></label>
      {businesses.size>1&&<p className="mm-error">เลือกต้นทางในธุรกิจเดียวกันก่อนบันทึก</p>}
      <button className="mm-primary" disabled={!choices.some(family=>family.key===familyKey)||!selected.length||selected.length>50||businesses.size!==1} onClick={()=>save(familyKey)}>{mappingState.saving?'กำลังบันทึก…':'บันทึก Map'}</button>
      <button disabled={!selected.length||selected.length>50} onClick={()=>save(null)}>เลิก Map รายการที่เลือก</button>
      <small>ครั้งละไม่เกิน 50 รายการ</small>
    </div></fieldset>
    {error&&<div className="mm-feedback mm-error" role="alert">{error} <button onClick={reload} disabled={mappingState.saving}>โหลดล่าสุด</button></div>}
  </section>
}
