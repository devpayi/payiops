const number=value=>Number.isFinite(value)?new Intl.NumberFormat('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value):'—'
const cents=value=>number(value/100)
const percent=value=>Number.isFinite(value)?`${value.toFixed(2)}%`:'—'

// Positions and RGB colours mirror Mall!A1:L32 in the owner's worksheet.
export default function TikTokWorksheet({draft,result,update}) {
  const cell=(column,row,content,{span=1,rows=1,tone='',align='',label}={})=><div key={`${column}-${row}`} className={`mall-cell ${tone} ${align}`} style={{gridColumn:`${column} / span ${span}`,gridRow:`${row} / span ${rows}`}} aria-label={label}>{content}</div>
  const input=(key,label,suffix='')=><span className="mall-input"><input aria-label={label} type="number" inputMode="decimal" min="0" max={['transaction','commission','campaign','deals','vat','targetMargin','affiliate'].includes(key)?100:10000000} step="0.01" value={Number.isNaN(draft[key])?'':draft[key]} onChange={e=>update(key,e.target.value)}/>{suffix&&<span>{suffix}</span>}</span>
  const valid=result.valid
  const price=valid?result.unitPrice:NaN
  const platformRate=['transaction','commission','campaign','deals','vat'].reduce((sum,k)=>sum+Number(draft[k]||0),0)
  const pct=amount=>valid?percent(amount/price*100):'—'
  const baseCost=['cost','packing','overhead'].reduce((sum,k)=>sum+Number(draft[k]||0),0)
  const cells=[
    cell(2,1,draft.productName,{span:2,tone:'black center'}),
    cell(2,2,'Value (THB)',{tone:'black center'}),cell(3,2,'Percent',{tone:'black center'}),
    cell(4,6,'',{tone:'black'}),cell(5,6,'ROI',{tone:'black center'}),cell(4,7,'',{tone:'black'}),cell(5,7,valid&&result.roi!==null?result.roi.toFixed(3):'—',{tone:'green center bold'}),
    cell(7,1,'',{rows:35,tone:'black'}),
    cell(8,1,'',{span:3,tone:'black'}),cell(8,2,'ค่าธรรมเนียม Platform',{span:3,tone:'blue bold'}),
    cell(10,3,<>ดูจาก Seller center ว่าเราเสียแต่ละอันเท่าไรบ้าง<br/>(แต่ละร้านเสียไม่เท่ากัน)</>,{rows:6,tone:'seller-note center'}),
    cell(11,1,<>กรอก<br/>เฉพาะสี<br/>เหลือง<br/>เท่านั้น!!</>,{rows:20,tone:'red instruction center bold'}),
    cell(8,8,'Total Platform + Vat',{tone:'red bold'}),cell(9,8,percent(platformRate),{tone:'red center bold'}),
    cell(8,9,'',{span:3,tone:'black'}),cell(8,10,'ราคาขาย & ทุน',{span:3,tone:'blue bold'}),cell(10,11,'หน่วย',{tone:'bold'}),
    cell(8,16,'Total COGS+Packing',{tone:'red bold'}),cell(9,16,number(baseCost),{tone:'red center bold'}),
    cell(8,17,'',{span:3,tone:'black'}),cell(8,18,'กำไรเราอยากได้ (%)',{tone:'bold'}),cell(9,18,input('targetMargin','กำไรเราอยากได้','%'),{tone:'yellow'}),cell(10,18,'%/ ต่อชิ้น',{tone:'bold'}),
    cell(8,19,'ค่าคอมนายหน้าผ่าน Ads (%)',{tone:'bold'}),cell(9,19,input('affiliate','ค่าคอมนายหน้าผ่าน Ads','%'),{tone:'yellow'}),cell(10,19,'%/ ต่อชิ้น',{tone:'bold'}),cell(8,20,'',{span:3,tone:'blue'}),
    cell(1,13,'Note',{span:5,tone:'black center bold'}),cell(1,14,'1. เป็นต้นทุนต่อสินค้า 1 สินค้า กรณีมีหลายสินค้าให้บันทึกแผนแยก เพื่อกันสับสน',{span:5,tone:'note bold'}),cell(1,15,'2. กรอกเฉพาะสีเหลือง ช่องอื่นคำนวณให้อัตโนมัติ',{span:5,tone:'note bold'}),
    cell(1,24,'Budget',{span:3,tone:'black bold'}),cell(4,24,'Budget (THB)',{tone:'black bold'}),cell(5,24,'Unit',{tone:'black bold'}),
    cell(1,30,'Note',{span:5,tone:'black center bold'}),cell(1,31,'1. เป็น budget ต่อ 1 สินค้า',{span:5,tone:'note bold'}),cell(1,32,'2. กรอกเฉพาะสีเหลือง ช่องอื่นคำนวณให้อัตโนมัติ',{span:5,tone:'note bold'}),
    cell(9,22,'28',{align:'right'}),cell(9,23,'Current'),cell(10,23,'Expectation'),
    cell(10,30,'1,000.00',{align:'right'}),cell(11,31,'ตะกร้าแดง'),cell(12,31,'5%',{align:'right'}),cell(11,32,'ตะกร้าเหลือง'),cell(12,32,'10%',{align:'right'}),
  ]
  const summary=[['ราคาขาย',price,null,'green'],['COGS+packing',valid?result.unitCost:NaN,valid?pct(result.unitCost):'—','rose'],['Affli',valid?result.affiliate:NaN,percent(Number(draft.affiliate)),'rose'],['Platform',valid?result.platformFees:NaN,percent(platformRate),'rose'],['Ads',valid?result.availableAds:NaN,valid?pct(result.availableAds):'—','rose'],['Total cost',valid?price-result.unitProfit:NaN,valid?pct(price-result.unitProfit):'—','red'],['กำไร',valid?result.unitProfit:NaN,percent(Number(draft.targetMargin)),'green']]
  summary.forEach(([label,value,pctValue,tone],index)=>{const row=index+3;cells.push(cell(1,row,label,{tone:'black'}),cell(2,row,cents(value),{tone:`${tone} center bold`}),cell(3,row,pctValue,{tone:`${tone} center bold`}))})
  const fees=[['transaction','Transaction Fee (ค่าธรรมเนียมคำสั่งซื้อ)'],['commission','ค่าคอมมิชชั่น Platform'],['campaign','Campaigns ส่งฟรี (สนับสนุนการเติบโต)'],['deals','ค่าบริการ Brand Crazy Deals/แฟลชเซล'],['vat','Vat']]
  fees.forEach(([key,label],index)=>{cells.push(cell(8,index+3,label,{tone:'bold'}),cell(9,index+3,input(key,label,'%'),{tone:'yellow'}))})
  const costs=[['price','ราคาขาย'],['cost','ต้นทุนสินค้า(รับจากโรงงาน)'],['packing','ค่ากล่อง หรือซอง + เทป (packing)'],['overhead','ค่าพนักงาน+ค่าเช่า+น้ำไฟ+อื่นๆ']]
  costs.forEach(([key,label],index)=>{cells.push(cell(8,index+12,label,{tone:'bold'}),cell(9,index+12,input(key,label),{tone:'yellow'}),cell(10,index+12,'บาท/ ต่อชิ้น',{tone:'bold'}))})
  const budgets=[['Budget ขั้นต่ำผ่าน learning phase',result.learningBudget,'budget-light'],['Budget ขั้นต่ำ สำหรับเป็น Hero SKUs',result.heroBudget,'budget-mid'],['Budget ขั้นต่ำ สำหรับเป็น Evergreen SKUs',result.evergreenBudget,'budget-dark']]
  budgets.forEach(([label,value,tone],index)=>{cells.push(cell(1,index+25,label,{span:3,tone:`${tone} bold`}),cell(4,index+25,valid?cents(value):'—',{tone:`${tone} center bold`}),cell(5,index+25,'บาท ต่อ วัน',{tone}))})
  const reference=[['GMV','7,800,000.00'],['Affli GMV','4,800,000.00'],['ROI','6.00'],['Ads spending','1,300,000.00'],['AOV','700'],['GMV per day','278,571.43'],['House per day','397.96']]
  reference.forEach(([label,value],index)=>cells.push(cell(8,index+24,label),cell(9,index+24,value,{align:'right'})))
  return <><div className="mall-sheet-scroll" tabIndex={0} role="region" aria-label="ตารางคำนวณ TikTok Mall ตามชีตต้นฉบับ"><div className="mall-sheet">{cells}</div></div><div className="mall-sheet-footnote">Current / Expectation เป็นข้อมูลอ้างอิงจากชีตต้นแบบ · ผลคำนวณปัดรายรายการถึงสตางค์</div></>
}
