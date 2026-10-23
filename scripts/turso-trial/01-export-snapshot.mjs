import fs from 'node:fs/promises'
import { getMeta, batchGetValues } from '../../api/_lib/sheets.js'
const out = process.argv[2]
await fs.mkdir(out, { recursive: true })
const meta = await getMeta()
const tabs = meta.sheets.map(s => s.properties.title).filter(t => t.startsWith('raw_orders'))
console.log(tabs.join(','))
for (const t of tabs) {
  const t0 = Date.now()
  const [r] = await batchGetValues([`'${t}'!A:V`])
  await fs.writeFile(`${out}/${t}.json`, JSON.stringify(r.values || []))
  console.log(t, (r.values||[]).length - 1, 'rows', Date.now() - t0, 'ms')
}
