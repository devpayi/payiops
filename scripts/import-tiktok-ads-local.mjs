// Offline import for local review only. No HTTP requests, Sheets writes or deploys.
import {readFile,mkdir,writeFile,rename,open,unlink} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import process from 'node:process'
import {buildTikTokMonthlyReport} from '../shared/tiktokAdsReport.js'
import {reportScope} from '../shared/marketingReadModels.js'

const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,all)=>index%2===0?[...pairs,[value.replace(/^--/,''),all[index+1]]]:pairs,[]))
if(!args.input || !args.business)throw Error('ระบุ --input <JSON> --business Payi และ --out-dir ได้')
if(process.env.VERCEL)throw Error('ไม่อนุญาตนำเข้าข้อมูลจริงผ่านสคริปต์นี้บนระบบเผยแพร่')
const digest=value=>createHash('sha256').update(value).digest('hex')
const bytes=await readFile(args.input)
const result=buildTikTokMonthlyReport(JSON.parse(bytes.toString('utf8')),{business:args.business})
if(result.status!=='reconciled')throw Error(`ไม่เก็บรายงานที่ยังไม่ตรง: ${result.issues.join(' · ')}`)
const report={...result,fingerprints:[`seller-center-dashboard:${digest(bytes)}`],localOnly:true,importedAt:new Date().toISOString()}
const identity=digest(JSON.stringify([result.platform,result.business,result.shopId,result.month,report.fingerprints]))
const root=resolve(args['out-dir'] || 'reports/marketing-monthly')
await mkdir(root,{recursive:true})
const lock=await open(join(root,'import.lock'),'wx')
try {
  let manifest
  try {manifest=JSON.parse(await readFile(join(root,'active.json'),'utf8'))}
  catch(error) {if(error.code!=='ENOENT')throw error;manifest={version:1,entries:[]}}
  if(manifest.version!==1 || !Array.isArray(manifest.entries))throw Error('manifest ไม่ถูกต้อง')
  const scope=reportScope(result)
  const existing=manifest.entries.find(e=>e.scope===scope)
  const filename=`report-${identity}.json`
  if(existing?.file===filename)console.log('ชุดนี้มีอยู่แล้ว ไม่เพิ่มยอดซ้ำ')
  else {
    // Going back to an earlier set (A -> B -> A): its file is still on disk, so reuse it.
    let json=JSON.stringify(report,null,2)+'\n'
    try {await writeFile(join(root,filename),json,{flag:'wx'})}
    catch(error) {
      if(error.code!=='EEXIST')throw error
      const previous=await readFile(join(root,filename),'utf8')
      report.importedAt=JSON.parse(previous).importedAt
      json=JSON.stringify(report,null,2)+'\n'
      if(previous!==json)throw Error('ไฟล์ชุดเดิมมีเนื้อหาไม่ตรง')
    }
    const next={version:1,entries:[...manifest.entries.filter(e=>e.scope!==scope && e.file!==filename),{scope,file:filename,sha256:digest(json),supersedes:existing?.file || null}]}
    const temp=join(root,`active-${randomUUID()}.tmp`)
    await writeFile(temp,JSON.stringify(next,null,2)+'\n',{flag:'wx'})
    await rename(temp,join(root,'active.json'))
    console.log(JSON.stringify({localOnly:true,platform:result.platform,month:result.month,spend:result.spend,sales:result.sales,orders:result.orders,campaigns:result.campaigns.length,status:result.status}))
  }
} finally {await lock.close();await unlink(join(root,'import.lock'))}
