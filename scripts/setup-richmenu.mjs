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
  // แตงผูก LINE ผ่านฝั่งพนักงาน (mp:TANG) ไม่ใช่บัญชี login 'tang' — ต้องตัด mp: ออกก่อนเทียบ
  const bareUsername = String(username || '').replace(/^mp:/i, '').toLowerCase()
  if (RICHMENU_STOCK_TIER_USERNAME_OVERRIDES.includes(bareUsername)) return 'stock'
  if (r === 'dev' || r === 'boss') return 'full'
  if (r === 'stock') return 'stock'
  return 'staff'
}

const APP_BASE_URL = String(process.env.APP_BASE_URL || '').replace(/\/$/, '')
const webUrl = (tab) => `${APP_BASE_URL}/${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`

// พิกัด areas ต้องตรงกับ hero_box/pill_boxes/card_boxes ใน gen-richmenu-images.py เป๊ะๆ เสมอ — ถ้าแก้เลย์เอาต์
// ที่ไฟล์นั้น ต้องแก้ตรงนี้ตามด้วยทุกครั้ง (เคยพลาดจุดนี้มาแล้ว: อัพเดตรูปเป็นเลย์เอาต์ hero+pills+cards แต่
// areas ยังเป็นกริด 3x3/2x2 สม่ำเสมอแบบเก่า กดปุ่มเลยไปโดนคนละอันกับที่เห็นในภาพ)
const menuDefs = [
  {
    tier: 'full',
    file: 'richmenu-full.png',
    size: { width: 1200, height: 810 },
    name: 'PAYI Ops - Full (Boss/Dev)',
    chatBarText: 'เมนู',
    areas: [
      // owner ขอ 2026-08-06 (v6, final): โครงเดียวกับ stock tier — hero "สั่งของ" + pill 2 ใบ (แจ้งของเข้า/
      // ของเข้ารอตรวจ) + การ์ดล่าง 4 ใบเท่ากัน (อนุมัติการลา/เช็คประวัติ/เว็บแอพ/ช่วยเหลือ) ไม่มี group/badge แล้ว
      { bounds: { x: 0, y: 0, width: 800, height: 540 }, action: { type: 'message', text: 'สั่งของ' } },              // hero
      { bounds: { x: 800, y: 0, width: 400, height: 270 }, action: { type: 'message', text: 'รายการที่สั่งไว้' } },   // pill 1
      { bounds: { x: 800, y: 270, width: 400, height: 270 }, action: { type: 'message', text: 'ของเข้ารอตรวจ' } },    // pill 2
      { bounds: { x: 0, y: 540, width: 300, height: 270 }, action: { type: 'message', text: 'อนุมัติการลา' } },       // card 1
      { bounds: { x: 300, y: 540, width: 300, height: 270 }, action: { type: 'message', text: 'เช็คประวัติ' } },      // card 2: เลือกเดือน -> ใครลาบ้าง
      { bounds: { x: 600, y: 540, width: 300, height: 270 }, action: { type: 'uri', uri: webUrl('Executive') } },     // card 3: เว็บแอพ -> หน้าหลัก
      { bounds: { x: 900, y: 540, width: 300, height: 270 }, action: { type: 'message', text: 'ช่วยเหลือ' } },        // card 4
    ],
  },
  {
    tier: 'stock',
    file: 'richmenu-stock.png',
    size: { width: 1200, height: 810 },
    name: 'PAYI Ops - Stock (ฟ้า/แตง)',
    chatBarText: 'เมนู',
    areas: [
      { bounds: { x: 0, y: 0, width: 800, height: 540 }, action: { type: 'message', text: 'แจ้งของเข้า' } },              // hero
      // ฟ้า/แตง มี mp: employee link ผูกกับ LINE account เดียวกันจริง (เช็ค hr_line_links แล้ว: mp:FAH กับ
      // mp:TANG line_user_id ตรงกับที่ใช้อยู่) staffLink เลย resolve ได้ปกติ ใช้คำสั่งพิมพ์จริงได้เหมือน staff
      // tier ทุกอย่าง — ของเดิมลิงก์ทั้ง 3 ปุ่มไปหน้า HR เว็บเหมือนกันหมด กดปุ่มไหนก็ไปที่เดียว ไม่ตรงกับป้ายปุ่ม
      { bounds: { x: 800, y: 0, width: 400, height: 270 }, action: { type: 'message', text: 'ลา' } },                     // pill 1: ขอลา
      { bounds: { x: 800, y: 270, width: 400, height: 270 }, action: { type: 'uri', uri: webUrl('Stock Movement') } },    // pill 2: เว็บแอพ -> หน้าหลักของฟ้า/แตง
      { bounds: { x: 0, y: 540, width: 400, height: 270 }, action: { type: 'message', text: 'ประวัติลา' } },             // card 1: เช็คประวัติ
      { bounds: { x: 400, y: 540, width: 400, height: 270 }, action: { type: 'message', text: 'สรุปลา' } },              // card 2: เช็ควันลาคงเหลือ
      { bounds: { x: 800, y: 540, width: 400, height: 270 }, action: { type: 'message', text: 'ช่วยเหลือ' } },           // card 3
    ],
  },
  {
    tier: 'staff',
    file: 'richmenu-staff.png',
    size: { width: 800, height: 540 },
    name: 'PAYI Ops - Staff',
    chatBarText: 'เมนู',
    areas: [
      { bounds: { x: 0, y: 0, width: 800, height: 300 }, action: { type: 'message', text: 'ลา' } },            // hero
      { bounds: { x: 0, y: 300, width: 267, height: 240 }, action: { type: 'message', text: 'ประวัติลา' } },   // card 1
      { bounds: { x: 267, y: 300, width: 267, height: 240 }, action: { type: 'message', text: 'สรุปลา' } },    // card 2
      { bounds: { x: 534, y: 300, width: 266, height: 240 }, action: { type: 'message', text: 'ช่วยเหลือ' } }, // card 3
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
