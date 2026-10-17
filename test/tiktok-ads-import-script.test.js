import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import process from 'node:process'

const input=spend=>({month:'2026-09',dateFrom:'2026-09-01',dateTo:'2026-09-30',shopId:'123',shopName:'Shop',totals:{spend,sales:'10',orders:'1'},
  campaigns:[{name:'A',grain:'product',spend,sales:'10',orders:'1',roas:'1'}]})
const run=(file,out)=>execFileSync(process.execPath,['scripts/import-tiktok-ads-local.mjs','--input',file,'--business','Payi','--out-dir',out],{encoding:'utf8',env:{...process.env,VERCEL:''}})

test('importing A, then B, then A again re-activates A without a duplicate or a crash',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'tt-import-'))
  try {
    const a=join(dir,'a.json'),b=join(dir,'b.json'),out=join(dir,'store')
    await writeFile(a,JSON.stringify(input('100')));await writeFile(b,JSON.stringify(input('200')))
    run(a,out);run(b,out);run(a,out)
    const manifest=JSON.parse(await readFile(join(out,'active.json'),'utf8'))
    assert.equal(manifest.entries.length,1)
    const active=JSON.parse(await readFile(join(out,manifest.entries[0].file),'utf8'))
    assert.equal(active.spend,'100')
    assert.equal((await readdir(out)).filter(f=>f.startsWith('report-')).length,2)
    assert.match(run(a,out),/ชุดนี้มีอยู่แล้ว/)
  } finally {await rm(dir,{recursive:true})}
})
