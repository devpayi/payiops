import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {createHash} from 'node:crypto'
import process from 'node:process'
import {createMarketingMonthlyRead,readLocalMonthlyReports} from '../api/_lib/marketingMonthlyRead.js'
import {signToken} from '../api/_lib/auth.js'
import {canAccessTab} from '../shared/roles.js'
import {legacyTikTokSales} from '../shared/marketingReadModels.js'

const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body;return this}})
test('private monthly reads enforce actual role guards and never write',async()=>{
  const original=process.env.AUTH_SECRET
  process.env.AUTH_SECRET='isolated-test-secret'
  try {
    let reads=0
    const handler=createMarketingMonthlyRead({production:()=>true,readReports:async()=>{reads++;return []}})
    for(const role of ['dev','boss','staff','marketing','finance','stock','tang']) {
      const res=response()
      await handler({method:'GET',query:{kind:'monthly-reports'},headers:{'x-api-token':signToken({role})}},res)
      assert.equal(res.code,['dev','boss'].includes(role)?200:403,role)
      assert.equal(canAccessTab(role,'TikTokSales'),['dev','boss'].includes(role),role)
    }
    const unauth=response()
    await handler({method:'GET',query:{kind:'monthly-reports'},headers:{}},unauth)
    assert.equal(unauth.code,401)
    const post=response()
    await handler({method:'POST',query:{kind:'monthly-reports'},headers:{'x-api-token':signToken({role:'dev'})}},post)
    assert.equal(post.code,405)
    assert.equal(reads,2)
    assert.equal(post.headers['Cache-Control'],'no-store')
  } finally {if(original===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=original}
})
test('production auth configuration fails closed before accessing data',async()=>{
  const handler=createMarketingMonthlyRead({production:()=>true,hasAuth:()=>false,authorize:()=>{throw Error('must not authorize')},readReports:()=>{throw Error('must not read')}})
  const res=response();await handler({method:'GET'},res);assert.equal(res.code,503)
})
test('legacy reader preserves zero and stored values without VAT or inferred channels',async()=>{
  const handler=createMarketingMonthlyRead({authorize:()=>true,production:()=>false,readInputs:async()=>[{month:'2026-09',business:'Payi',platform:'TikTok',metric:'live',value:0},{month:'2026-09',business:'Payi',platform:'TikTok',metric:'ads',value:'107.00'}]})
  const res=response();await handler({method:'GET',query:{kind:'sales-channels-read'}},res)
  assert.equal(res.code,200);assert.deepEqual(res.body.inputs.map(r=>r.value),[0,'107.00'])
  assert.equal(res.headers['Cache-Control'],'no-store')
})
test('local manifest rejects corruption, traversal and duplicate scopes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'payi-monthly-test-'))
  try {
    const raw=JSON.stringify({schemaVersion:1,status:'reconciled',fingerprints:['test'],business:'Payi',shopId:'1',month:'2026-09'})
    const file=`report-${'a'.repeat(64)}.json`
    const entry={file,sha256:createHash('sha256').update(raw).digest('hex')}
    const manifest=entries=>writeFile(join(root,'active.json'),JSON.stringify({version:1,entries}))
    await writeFile(join(root,file),raw);await manifest([entry])
    assert.equal((await readLocalMonthlyReports(root)).length,1)
    await manifest([{...entry,file:'../private.json'}]);await assert.rejects(readLocalMonthlyReports(root),/ชื่อไฟล์/)
    await manifest([entry,entry]);await assert.rejects(readLocalMonthlyReports(root),/ซ้ำ/)
    await manifest([entry]);await writeFile(join(root,file),raw+' ');await assert.rejects(readLocalMonthlyReports(root),/เปลี่ยน/)
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep))
    await rm(root,{recursive:true,force:true})
  }
})
test('formatted Sheets amounts survive the API to TikTok read model',async()=>{
  const source=['1,234.50','0','','12,34'].map((value,index)=>({month:'2026-09',business:`B${index}`,platform:'TikTok Shop',metric:'tt_gmv',value}))
  const handler=createMarketingMonthlyRead({authorize:()=>true,production:()=>false,readInputs:async()=>source})
  const res=response();await handler({method:'GET',query:{kind:'sales-channels-read'}},res)
  assert.deepEqual(source.map((_,index)=>legacyTikTokSales(res.body.inputs,'2026-09',`B${index}`).gmv),[
    {value:1234.5,status:'present'},{value:0,status:'present'},{value:null,status:'invalid'},{value:null,status:'invalid'},
  ])
})
