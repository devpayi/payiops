import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import process from 'node:process'
const baseline=JSON.parse(readFileSync(new URL('../docs/baselines/marketing-monthly-before.json',import.meta.url),'utf8').replace(/^\uFEFF/,''))
// Stage 2 integrates read-only navigation and an isolated dispatcher branch.
// The original writer, CFO and monthly calculation handlers remain byte-identical.
const intentional=new Set(['src/App.jsx','src/pages/AdsChannels.jsx','src/pages/MonthlyDashboard.jsx','shared/roles.js','api/marketing.js'])
const results=baseline.files.map(file=>{
  const sha256=createHash('sha256').update(readFileSync(new URL(`../${file.path}`,import.meta.url))).digest('hex')
  return {path:file.path,status:sha256===file.sha256?'unchanged':intentional.has(file.path)?'review-read-only-integration':'UNEXPECTED CHANGE'}
})
console.log(JSON.stringify(results,null,2))
if(results.some(r=>r.status==='UNEXPECTED CHANGE'))process.exitCode=1
