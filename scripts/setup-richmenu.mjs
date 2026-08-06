// One-off script: create the 3 rich menus, upload images, save richmenu_id map to the Sheet,
// then backfill-assign every already-linked LINE user to their tier.
//
// Needs LINE_CHANNEL_ACCESS_TOKEN in your local .env (not committed — pull the real value from
// the Vercel dashboard env vars and paste it into your local .env just for this run, or run this
// script from a machine/shell that already has it exported). Also needs the usual
// GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY/SHEET_ID that are already in .env.
//
// Run (from repo root):  node --env-file=.env scripts/setup-richmenu.mjs
// Safe to re-run — old rich menus from a previous run are left orphaned on LINE's side (not
// reused/deleted), just overwrites the richmenu_id map in the Sheet with the freshly created ones.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRichMenu, uploadRichMenuImage, linkRichMenuToUser, setDefaultRichMenu } from '../api/_lib/line.js'
import { getSheet, overwriteSheet, ensureSheet } from '../api/_lib/sheets.js'
import { normalizeRole } from '../shared/roles.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const RICHMENU_SHEET = 'line_richmenu_ids'
const RICHMENU_HEADERS = ['tier', 'richmenu_id', 'updated_at']
const RICHMENU_STOCK_TIER_USERNAME_OVERRIDES = ['tang']

function richMenuTierForRole(role, username) {
  const r = normalizeRole(role)
  if (RICHMENU_STOCK_TIER_USERNAME_OVERRIDES.includes(String(username || '').toLowerCase())) return 'stock'
  if (r === 'dev' || r === 'boss') return 'full'
  if (r === 'stock') return 'stock'
  return 'staff'
}

const APP_BASE_URL = String(process.env.APP_BASE_URL || '').replace(/\/$/, '')
const webUrl = (tab) => `${APP_BASE_URL}/${tab ? `?tab=${tab}` : ''}`

const menuDefs = [
  {
    tier: 'full',
    file: 'richmenu-full.png',
    size: { width: 1200, height: 810 },
    name: 'PAYI Ops - Full (Boss/Dev)',
    chatBarText: 'เมนู',
    areas: [
      { bounds: { x: 0, y: 0, width: 400, height: 270 }, action: { type: 'message', text: 'แจ้งของเข้า' } },
      { bounds: { x: 400, y: 0, width: 400, height: 270 }, action: { type: 'message', text: 'สั่งของ' } },
      { bounds: { x: 800, y: 0, width: 400, height: 270 }, action: { type: 'message', text: 'ของเข้ารอตรวจ' } },
      { bounds: { x: 0, y: 270, width: 400, height: 270 }, action: { type: 'message', text: 'อนุมัติการลา' } },
      { bounds: { x: 400, y: 270, width: 400, height: 270 }, action: { type: 'uri', uri: webUrl('HR') } },
      { bounds: { x: 800, y: 270, width: 400, height: 270 }, action: { type: 'uri', uri: webUrl() } },
      { bounds: { x: 0, y: 540, width: 400, height: 270 }, action: { type: 'message', text: 'ช่วยเหลือ' } },
      { bounds: { x: 400, y: 540, width: 400, height: 270 }, action: { type: 'uri', uri: webUrl() } },
      { bounds: { x: 800, y: 540, width: 400, height: 270 }, action: { type: 'uri', uri: webUrl() } },
    ],
  },
  {
    tier: 'stock',
    file: 'richmenu-stock.png',
    size: { width: 800, height: 540 },
    name: 'PAYI Ops - Stock (ฟ้า/แตง)',
    chatBarText: 'เมนู',
    areas: [
      { bounds: { x: 0, y: 0, width: 400, height: 270 }, action: { type: 'message', text: 'แจ้งของเข้า' } },
      { bounds: { x: 400, y: 0, width: 400, height: 270 }, action: { type: 'uri', uri: webUrl('HR') } },
      { bounds: { x: 0, y: 270, width: 400, height: 270 }, action: { type: 'uri', uri: webUrl() } },
      { bounds: { x: 400, y: 270, width: 400, height: 270 }, action: { type: 'message', text: 'ช่วยเหลือ' } },
    ],
  },
  {
    tier: 'staff',
    file: 'richmenu-staff.png',
    size: { width: 800, height: 540 },
    name: 'PAYI Ops - Staff',
    chatBarText: 'เมนู',
    areas: [
      { bounds: { x: 0, y: 0, width: 400, height: 270 }, action: { type: 'message', text: 'ลา' } },
      { bounds: { x: 400, y: 0, width: 400, height: 270 }, action: { type: 'message', text: 'ประวัติลา' } },
      { bounds: { x: 0, y: 270, width: 400, height: 270 }, action: { type: 'message', text: 'สรุปลา' } },
      { bounds: { x: 400, y: 270, width: 400, height: 270 }, action: { type: 'message', text: 'ช่วยเหลือ' } },
    ],
  },
]

const IMAGE_DIR = process.env.RICHMENU_IMAGE_DIR || path.join(__dirname, 'richmenu-assets')

async function main() {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('LINE_CHANNEL_ACCESS_TOKEN not set — pull it from Vercel dashboard env vars into your local .env first.')
    process.exit(1)
  }

  const tierToId = {}
  for (const def of menuDefs) {
    console.log(`Creating menu: ${def.name}`)
    const created = await createRichMenu({
      size: def.size,
      selected: def.tier === 'staff', // staff = default/least-privileged, shown to anyone before they're assigned
      name: def.name,
      chatBarText: def.chatBarText,
      areas: def.areas,
    })
    if (!created.ok) { console.error('  FAILED:', created.error); process.exit(1) }
    console.log(`  richMenuId: ${created.richMenuId}`)

    const imagePath = `${IMAGE_DIR}/${def.file}`
    const buffer = fs.readFileSync(imagePath)
    const uploaded = await uploadRichMenuImage(created.richMenuId, buffer, 'image/png')
    if (!uploaded.ok) { console.error('  IMAGE UPLOAD FAILED:', uploaded.error); process.exit(1) }
    console.log('  image uploaded ok')

    tierToId[def.tier] = created.richMenuId
  }

  // ตั้ง staff tier เป็น default — ใครยังไม่เคย resolve tier ได้ (บัญชีใหม่/ยังไม่ผูก) เห็นเมนูนี้ก่อน
  const setDefault = await setDefaultRichMenu(tierToId.staff)
  console.log('set default (staff):', setDefault.ok ? 'ok' : setDefault.error)

  // บันทึก richMenuId ต่อ tier ลงชีท — assignRichMenuForLink (ในแอพจริง) อ่านจากตรงนี้ตอนมีคนผูก LINE ใหม่
  await ensureSheet(RICHMENU_SHEET, RICHMENU_HEADERS)
  const now = new Date().toISOString()
  const rows = Object.entries(tierToId).map(([tier, id]) => [tier, id, now])
  await overwriteSheet(RICHMENU_SHEET, RICHMENU_HEADERS, rows)
  console.log('saved richmenu_id map to sheet:', tierToId)

  // Backfill — ผูกเมนูให้ทุกคนที่เคยผูก LINE ไว้แล้วก่อนหน้านี้ (คนใหม่หลังจากนี้ auto-assign ผ่าน
  // assignRichMenuForLink ตอน set-line-id/set-line-id-for อยู่แล้ว ไม่ต้องรันสคริปต์นี้ซ้ำ)
  const [links, users] = await Promise.all([getSheet('hr_line_links'), getSheet('users')])
  let assigned = 0, failed = 0
  for (const link of links) {
    if (!link.line_user_id) continue
    const user = users.find((u) => u.username === link.username)
    const tier = richMenuTierForRole(user?.role, link.username)
    const richMenuId = tierToId[tier]
    if (!richMenuId) continue
    const result = await linkRichMenuToUser(link.line_user_id, richMenuId)
    if (result.ok) { assigned++; console.log(`  linked ${link.username} -> ${tier}`) }
    else { failed++; console.error(`  FAILED ${link.username} -> ${tier}:`, result.error) }
    await new Promise((r) => setTimeout(r, 300)) // ไม่ยิงรัวๆ กันโดน rate limit
  }
  console.log(`Backfill done: ${assigned} assigned, ${failed} failed.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
