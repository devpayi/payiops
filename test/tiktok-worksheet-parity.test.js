import test from 'node:test'
import assert from 'node:assert/strict'
import {calculateTikTok,newTikTokDraft} from '../shared/tiktokPricing.js'

// Formula/value readback from the owner's Mall!A1:J19, 15 Oct 2026.
const template={"B3":"=I12","I3":0.0321,"B4":"=I16+1.06","C4":"=B4/B3","I4":0.1177,"B5":"=C5*B3","C5":"=I19","I5":0.0803,"B6":"=B3*C6","C6":"=I8","I6":0.0321,"B7":"=C7*B3","C7":"=1-(C4+C5+C6+C9)","E7":"=100%/C7","I7":0.07,"B8":"=sum(B4:B7)","C8":"=B8/B3","I8":"=sum(I3:I7)","B9":"=C9*B3","C9":"=I18","I12":395,"I13":100,"I14":5,"I15":2,"I16":"=sum(I13:I15)","I18":0.1,"I19":0.15}
function sheetValue(cells,address) {
  const raw=cells[address]
  if(typeof raw==='number')return raw
  let expression=raw.slice(1).replace(/sum\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)/gi,(_,c,a,d,b)=>{assert.equal(c,d);return '('+Array.from({length:Number(b)-Number(a)+1},(_,i)=>sheetValue(cells,c+(Number(a)+i))).join('+')+')'})
  expression=expression.replace(/([A-Z]+\d+)/g,address=>'('+sheetValue(cells,address)+')').replace(/(\d+(?:\.\d+)?)%/g,'($1/100)')
  assert.match(expression,/^[\d\s.eE+*/()\-]+$/)
  return Function('return ('+expression+')')()
}
const rateCells={transaction:'I3',commission:'I4',campaign:'I5',deals:'I6',vat:'I7',targetMargin:'I18',affiliate:'I19'}
test('all 7 initial rates and all source cost/price inputs match live worksheet readback',()=>{
  const d=newTikTokDraft()
  for(const [key,address]of Object.entries(rateCells))assert.ok(Math.abs(d[key]/100-template[address])<1e-12,key)
  for(const [key,address]of Object.entries({price:'I12',cost:'I13',packing:'I14',overhead:'I15'}))assert.equal(d[key],template[address],key)
  assert.ok(Math.abs(sheetValue(template,'B4')-sheetValue(template,'I16')-d.extraCost)<1e-12)
})
test('1,000 scenarios match 16 original worksheet formula outputs without intermediate satang rounding',()=>{
  let checks=0
  for(let i=0;i<1000;i++) {
    const d={...newTikTokDraft(),price:i===0?395:10+(i*7919%500000)/100,cost:i===0?100:(i*3571%10000)/100,packing:i===0?5:(i%200)/100,overhead:i===0?2:(i%300)/100}
    if(i>0)for(const [j,key]of Object.keys(rateCells).entries())d[key]=(i*(j+3)*37%2000)/100
    const cells={...template,I12:d.price,I13:d.cost,I14:d.packing,I15:d.overhead}
    for(const [key,address]of Object.entries(rateCells))cells[address]=d[key]/100
    const r=calculateTikTok(d);assert.equal(r.valid,true)
    const expected={B3:r.unitPrice/100,B4:r.unitCost/100,B5:r.affiliate/100,B6:r.platformFees/100,B7:r.availableAds/100,B8:(r.unitPrice-r.unitProfit)/100,B9:r.unitProfit/100,C4:r.unitCost/r.unitPrice,C5:d.affiliate/100,C6:Object.keys(rateCells).slice(0,5).reduce((s,k)=>s+d[k]/100,0),C7:r.availableAds/r.unitPrice,C8:(r.unitPrice-r.unitProfit)/r.unitPrice,C9:d.targetMargin/100,I8:Object.keys(rateCells).slice(0,5).reduce((s,k)=>s+d[k]/100,0),I16:d.cost+d.packing+d.overhead}
    if(r.availableAds>0)expected.E7=r.roi
    for(const [address,value]of Object.entries(expected)){const source=sheetValue(cells,address);assert.ok(Math.abs(source-value)<=1e-7*Math.max(1,Math.abs(source)),`${i} ${address}: ${source} vs ${value}`);checks++}
  }
  assert.ok(checks>=15000)
})
