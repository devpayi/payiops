// Explicit opt-in writes one clearly labelled sample plan to the private store.
// Run preflight first with the same target environment. Never use production's
// AUTH_SECRET for local previews; the local overlay uses an independent secret.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import handler from '../api/sheet-tools.js'
import { signToken } from '../api/_lib/auth.js'
import { pricingConfigured } from '../api/_lib/pricingStore.js'
import { newPricingDraft } from '../shared/pricing.js'
import { pricingAccounts } from '../api/_lib/pricing.js'

assert.ok(process.env.AUTH_SECRET && pricingConfigured(), 'Run pricing-preflight first')
async function call(user, action, method='GET', body={}) {
  const res={code:200,setHeader(){},status(code){this.code=code;return this},json(data){this.data=data;return this}}
  await handler({ method,headers:user?{'x-api-token':signToken({u:user,role:user==='boss'?'boss':'dev'})}:{},query:{op:'pricing',action,...(action==='recover'?{requestId:body.requestId}:{})},body,rawBody:JSON.stringify(body) },res)
  return res
}
assert.equal((await call(null,'access')).code,401)
assert.equal((await call('other-dev','bootstrap')).code,403)
for(const user of pricingAccounts()) {
  const access=await call(user,'access');assert.equal(access.code,200);assert.equal(access.data.allowed,true);assert.equal(access.data.demo,false)
}
const bootstrap=await call('dev','bootstrap');assert.equal(bootstrap.code,200);assert.equal(bootstrap.data.storageConfigured,true);assert.ok(!bootstrap.data.storageError)
console.log(`PASS authenticated routes; Ops catalog ${bootstrap.data.catalog.length} products; private history readable`)
if (process.argv.includes('--write-sample')) {
  mkdirSync('tmp/pricing-release',{recursive:true})
  const path='tmp/pricing-release/smoke-request.json'
  const body=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{requestId:randomUUID(),draft:{...newPricingDraft(),name:'[ตรวจระบบ] แผนตัวอย่างก่อนเปิดใช้งาน',sku:'RELEASE-CHECK',productName:'ข้อมูลตัวอย่างสำหรับตรวจบันทึก ห้ามใช้ตั้งราคาจริง'}}
  if(!existsSync(path))writeFileSync(path,JSON.stringify(body))
  // Keep request ID on disk before writing so reruns recover the same sample.
  const saved=await call('dev','save-scenario','POST',body)
  assert.equal(saved.code,200,'Save not confirmed; use recover with saved request ID before retrying')
  const recovered=await call('dev','recover','GET',{requestId:body.requestId})
  assert.equal(recovered.code,200);assert.equal(recovered.data.record.revisionId,saved.data.record.revisionId)
  assert.equal(recovered.data.record.result.profit,18106)
  const duplicate=await call('dev','save-scenario','POST',body)
  assert.equal(duplicate.code,200);assert.equal(duplicate.data.record.revisionId,saved.data.record.revisionId)
  console.log('PASS real private Sheets save / readback / duplicate protection; one labelled RELEASE-CHECK sample retained')
}
