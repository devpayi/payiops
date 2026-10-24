import fs from 'node:fs'
import { getSheet } from '../../api/_lib/sheets.js'
const log = await getSheet('import_log')
const ids = new Map(log.map(r => [r.import_id, r.status]))
console.log('import_log rows', log.length, 'active', log.filter(r => r.status === 'active').length, 'deleted', log.filter(r => r.status === 'deleted').length)
const dir = process.argv[2]
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const v = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')); if (v.length < 2) continue
  const H = v[0]; const ix = n => H.indexOf(n)
  let total = 0, noImport = 0, unknownImport = 0, deletedImport = 0, noStamp = 0, badStamp = 0, shortRow = 0, keyMismatch = 0
  for (const r of v.slice(1)) {
    total++
    const iid = r[ix('import_id')] || ''
    if (!iid) noImport++
    else if (!ids.has(iid)) unknownImport++
    else if (ids.get(iid) === 'deleted') deletedImport++
    if (!r[ix('imported_at')]) noStamp++
    else if (isNaN(Date.parse(r[ix('imported_at')]))) badStamp++
    if (r.length < 18) shortRow++
    const k = String(r[0] || '')
    if (k && !k.startsWith(String(r[ix('platform')]) + ':')) keyMismatch++
  }
  console.log(f.replace('.json',''), 'rows', total, '| noImportId', noImport, 'unknownImportId', unknownImport, 'importDeleted', deletedImport, '| noStamp', noStamp, 'badStamp', badStamp, 'shortRow(<18col)', shortRow, 'keyPrefix≠platform', keyMismatch)
}
