// Offline import for local review only. No HTTP requests, Sheets writes or deploys.
import {readFile,mkdir,writeFile,rename,open,unlink} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import process from 'node:process'
import {parseShopeeMonthlyReport,buildShopeeMonthlyReport} from '../shared/monthlyAdsReports.js'

const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,all)=>index%2===0?[...pairs,[value.replace(/^--/,''),all[index+1]]]:pairs,[]))
if(!args.overview || !args.detail || !args.business)throw Error('ระบุ --overview <CSV> --detail <CSV> --business Payi และ --out-dir ได้')
if(process.env.VERCEL)throw Error('ไม่อนุญาตนำเข้าข้อมูลจริงผ่านสคริปต์นี้บนระบบเผยแพร่')
const digest=value=>createHash('sha256').update(value).digest('hex')
const parse=async (file,kind)=>{
  const bytes=await readFile(file)
  const report=parseShopeeMonthlyReport(bytes.toString('utf8'),{filename:file.split(/[\\/]/).at(-1)})
  if(report.kind!==kind)throw Error('เลือกประเภทรายงานไม่ตรงกับพารามิเตอร์')
  return {...report,fingerprint:digest(bytes)}
}
const [overview,detail]=await Promise.all([parse(args.overview,'overview'),parse(args.detail,'group-detail')])
const result=buildShopeeMonthlyReport(overview,detail,{business:args.business})
if(result.status!=='reconciled')throw Error(`ไม่เก็บรายงานที่ยังไม่ตรง: ${result.issues.join(' · ')}`)
const report={...result,fingerprints:[`overview:${overview.fingerprint}`,`group-detail:${detail.fingerprint}`].sort(),localOnly:true,importedAt:new Date().toISOString()}
const identity=digest(JSON.stringify([result.business,result.shopId,result.month,report.fingerprints]))
const root=resolve(args['out-dir'] || 'reports/marketing-monthly')
await mkdir(root,{recursive:true})
const lock=await open(join(root,'import.lock'),'wx')
try {
  let manifest
  try {manifest=JSON.parse(await readFile(join(root,'active.json'),'utf8'))}
  catch(error) {if(error.code!=='ENOENT')throw error;manifest={version:1,entries:[]}}
  if(manifest.version!==1 || !Array.isArray(manifest.entries))throw Error('manifest ไม่ถูกต้อง')
  const scope=JSON.stringify([result.business,result.shopId,result.month])
  const existing=manifest.entries.find(e=>e.scope===scope)
  const filename=`report-${identity}.json`
  if(existing?.file===filename)console.log('ชุดนี้มีอยู่แล้ว ไม่เพิ่มยอดซ้ำ')
  else {
    const json=JSON.stringify(report,null,2)+'\n'
    try {await writeFile(join(root,filename),json,{flag:'wx'})}
    catch(error) {if(error.code!=='EEXIST')throw error;const previous=await readFile(join(root,filename),'utf8');report.importedAt=JSON.parse(previous).importedAt;if(previous!==JSON.stringify(report,null,2)+'\n')throw Error('ไฟล์ชุดเดิมมีเนื้อหาไม่ตรง')}
    const saved=await readFile(join(root,filename),'utf8')
    const next={version:1,entries:[...manifest.entries.filter(e=>e.scope!==scope),{scope,file:filename,sha256:digest(saved),supersedes:existing?.file || null}]}
    const temp=join(root,`active-${randomUUID()}.tmp`)
    await writeFile(temp,JSON.stringify(next,null,2)+'\n',{flag:'wx'})
    await rename(temp,join(root,'active.json'))
    console.log(JSON.stringify({localOnly:true,month:result.month,spend:result.spend,productSpend:result.productSpend,products:result.products.length,status:result.status}))
  }
} finally {await lock.close();await unlink(join(root,'import.lock'))}
