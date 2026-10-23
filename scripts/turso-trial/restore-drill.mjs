// ซ้อมกู้คืน: สำรอง raw_orders ใน Turso ลงไฟล์ libSQL ในเครื่อง แล้วกู้เข้าฐานเปล่าอีกก้อน และเทียบ fingerprint ต่อแท็บ
// (ยืนยันว่าสำรอง/กู้ข้อมูลได้ครบจริง — ไม่ได้ทดสอบ point-in-time restore ของ Turso เอง ซึ่งแพ็กเกจฟรีเก็บ 1 วัน)
//   node --use-system-ca --env-file=.env scripts/turso-trial/restore-drill.mjs [backup.db]
import fs from 'node:fs'
import { createClient } from '@libsql/client'
process.env.TURSO_MIRROR = 'on'
const { ensureSchema, tursoFingerprint, TABLE, RAW_HEADERS } = await import('../../api/_lib/ordersMirror.js')
const remote = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
const path = process.argv[2] || 'scripts/turso-trial/backup-drill.sqlite'
const restoredPath = path.replace(/\.sqlite$/, '') + '-restored.sqlite'
for (const p of [path, restoredPath]) if (fs.existsSync(p)) throw new Error(`${p} มีอยู่แล้ว — เลือกชื่อใหม่ (ไม่ทับหลักฐานเดิม)`)
const COLS = [...RAW_HEADERS, 'src_tab', 'ym', 'ex']
const tabs = (await remote.execute(`SELECT DISTINCT src_tab FROM ${TABLE} ORDER BY 1`)).rows.map((r) => r[0])
const backup = createClient({ url: `file:${path}` }); await ensureSchema(backup)
const restored = createClient({ url: `file:${restoredPath}` }); await ensureSchema(restored)
const ins = `INSERT INTO ${TABLE}(${COLS.join(',')}) VALUES(${COLS.map(() => '?').join(',')})`
const copy = async (from, to, tab) => {
  const rs = await from.execute({ sql: `SELECT ${COLS.join(',')} FROM ${TABLE} WHERE src_tab = ?`, args: [tab] })
  for (let i = 0; i < rs.rows.length; i += 500) await to.batch(rs.rows.slice(i, i + 500).map((r) => ({ sql: ins, args: COLS.map((c, k) => r[k]) })), 'write')
  return rs.rows.length
}
let bad = 0
for (const tab of tabs) {
  const n = await copy(remote, backup, tab)      // สำรอง
  await copy(backup, restored, tab)               // กู้เข้าฐานเปล่า
  const [a, b, c] = [await tursoFingerprint(remote, tab), await tursoFingerprint(backup, tab), await tursoFingerprint(restored, tab)]
  const same = JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(b) === JSON.stringify(c)
  if (!same) bad++
  console.log(tab.padEnd(20), n, 'แถว', same ? 'ตรง (turso = สำรอง = กู้คืน)' : 'ไม่ตรง!', a.hash)
}
console.log(bad ? `ล้มเหลว ${bad} แท็บ` : 'ซ้อมกู้คืนผ่านทุกแท็บ', '| ไฟล์สำรอง:', path)
process.exit(bad ? 1 : 0)
