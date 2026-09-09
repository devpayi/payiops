// /api/tiktok — เชื่อม TikTok Shop Open API เพื่อดึงออเดอร์เข้า raw_orders อัตโนมัติ (แทนการ export
// ไฟล์ด้วยมือทุกวัน)
//
//   GET ?action=authorize              → เด้งไปหน้าอนุญาตของ TikTok (ผู้ขายกดครั้งเดียวต่อร้าน)
//   GET ?action=callback&code=...      → TikTok เด้งกลับมาที่นี่ (redirect URL ของ app) — แลก token เก็บลงชีต
//   GET ?action=status                 → (dev) ดูร้านที่เชื่อมแล้ว + ซิงก์ล่าสุดเมื่อไหร่
//   GET ?action=pull[&hours=N]         → (dev) ดึงออเดอร์เดี๋ยวนี้ — ใช้เทสหลัง deploy
//   GET ?cron=pull                     → Vercel Cron รายวัน (ยืนยันด้วย CRON_SECRET)
//
// ENV: TIKTOK_APP_KEY, TIKTOK_APP_SECRET, TIKTOK_SERVICE_ID, (CRON_SECRET สำหรับ cron)
//
// ⚠️ token เก็บในชีต mona-ops-db ซึ่ง "แชร์แบบ link อ่านได้" อยู่ตอนนี้ — เข้ารหัส token ด้วย
// AES-256-GCM (คีย์จาก TIKTOK_APP_SECRET) ก่อนเก็บ และเจ้าของร้านควรปิดการแชร์ลิงก์ชีต
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { requireDev } from './_lib/auth.js'
import { ensureSheet, getSheet, appendRows, overwriteSheet } from './_lib/sheets.js'
import {
  authorizeUrl, exchangeAuthCode, refreshAccessToken, getAuthorizedShops,
  listOrderIds, getOrderDetails, ordersToRows, config,
} from './_lib/tiktokApi.js'
import { ingestOrders } from './_lib/ingestOrders.js'

const TOKENS_SHEET = 'platform_tokens'
const TOKENS_HEADERS = ['platform', 'shop_name', 'shop_id', 'shop_cipher', 'access_token', 'access_expires_at', 'refresh_token', 'refresh_expires_at', 'connected_at', 'last_sync_at', 'status']

// ── เข้ารหัส token ──
const encKey = () => scryptSync(String(process.env.TIKTOK_APP_SECRET || 'x'), 'payiops-tiktok', 32)
function enc(plain) {
  if (!plain) return ''
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', encKey(), iv)
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  return `enc:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`
}
function dec(stored) {
  const s = String(stored || '')
  if (!s.startsWith('enc:')) return s // เผื่อแถวเก่าที่ยังไม่เข้ารหัส
  const [, ivB, tagB, ctB] = s.split(':')
  const d = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivB, 'base64'))
  d.setAuthTag(Buffer.from(tagB, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ctB, 'base64')), d.final()]).toString('utf8')
}

async function loadTokenRows() {
  await ensureSheet(TOKENS_SHEET, TOKENS_HEADERS)
  const rows = await getSheet(TOKENS_SHEET)
  return rows.filter((r) => r.platform === 'TikTok Shop')
}

async function saveTokenRows(allRows) {
  await overwriteSheet(TOKENS_SHEET, TOKENS_HEADERS, allRows.map((r) => TOKENS_HEADERS.map((h) => r[h] ?? '')))
}

// upsert 1 ร้าน (key = shop_id) — อ่านทั้งชีต แก้/เพิ่ม เขียนกลับ
async function upsertToken(patch) {
  await ensureSheet(TOKENS_SHEET, TOKENS_HEADERS)
  const all = await getSheet(TOKENS_SHEET)
  const idx = all.findIndex((r) => r.platform === 'TikTok Shop' && r.shop_id === patch.shop_id)
  if (idx >= 0) all[idx] = { ...all[idx], ...patch }
  else all.push({ platform: 'TikTok Shop', ...patch })
  await saveTokenRows(all)
}

const htmlPage = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 20px;line-height:1.6;color:#16181d"><h2>${title}</h2>${body}</body>`

export default async function handler(req, res) {
  // TikTok เด้งกลับพร้อม ?code= (บางกรณี query 'action' หายถ้า redirect URL ที่ตั้งไว้ไม่มี ?action=callback)
  const action = String(req.query.action || (req.query.cron ? 'cron' : (req.query.code || req.query.auth_code ? 'callback' : '')))

  try {
    // ── authorize: เด้งไป TikTok ──
    if (action === 'authorize') {
      if (!config.hasCreds()) return res.status(500).send('ยังไม่ได้ตั้ง ENV TIKTOK_APP_KEY / TIKTOK_APP_SECRET / TIKTOK_SERVICE_ID')
      res.writeHead(302, { Location: authorizeUrl(String(req.query.state || '')) })
      return res.end()
    }

    // ── callback: TikTok เด้งกลับพร้อม ?code= ──
    if (action === 'callback') {
      const code = String(req.query.code || req.query.auth_code || '')
      if (!code) return res.status(400).send(htmlPage('เชื่อมไม่สำเร็จ', '<p>ไม่พบ code จาก TikTok ลองกดลิงก์อนุญาตใหม่</p>'))
      const tok = await exchangeAuthCode(code)
      const accessToken = tok.access_token
      const shops = await getAuthorizedShops(accessToken)
      if (!shops.length) return res.status(400).send(htmlPage('เชื่อมไม่สำเร็จ', '<p>token ใช้ได้แต่ไม่พบร้านที่อนุญาต</p>'))
      const now = Date.now()
      for (const s of shops) {
        await upsertToken({
          shop_name: s.name || '', shop_id: String(s.id || ''), shop_cipher: s.cipher || '',
          access_token: enc(accessToken), access_expires_at: new Date((tok.access_token_expire_in || 0) * 1000).toISOString(),
          refresh_token: enc(tok.refresh_token || ''), refresh_expires_at: new Date((tok.refresh_token_expire_in || 0) * 1000).toISOString(),
          connected_at: new Date(now).toISOString(), status: 'active',
        })
      }
      return res.status(200).send(htmlPage('เชื่อม TikTok Shop สำเร็จ ✅',
        `<p>เชื่อมแล้ว: <b>${shops.map((s) => s.name).join(', ')}</b></p><p>ระบบจะดึงออเดอร์อัตโนมัติทุกวัน ปิดหน้านี้ได้เลย</p>`))
    }

    // ── status ──
    if (action === 'status') {
      if (!requireDev(req, res)) return
      const rows = await loadTokenRows()
      return res.status(200).json({
        success: true,
        shops: rows.map((r) => ({ shop_name: r.shop_name, shop_id: r.shop_id, status: r.status, last_sync_at: r.last_sync_at || null, access_expires_at: r.access_expires_at })),
      })
    }

    // ── pull (dev เทสด้วยมือ) / cron (รายวัน) ──
    if (action === 'pull' || action === 'cron') {
      if (action === 'cron') {
        const authz = req.headers.authorization || ''
        if (process.env.CRON_SECRET && authz !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'unauthorized' })
      } else {
        if (!requireDev(req, res)) return
      }

      const hours = Math.min(Number(req.query.hours) || 26, 24 * 14) // default 26 ชม. (เผื่อ cron พลาด 1 รอบ)
      const untilSec = Math.floor(Date.now() / 1000)
      const rows = await loadTokenRows()
      const results = []

      for (const row of rows.filter((r) => r.status === 'active')) {
        try {
          let accessToken = dec(row.access_token)
          // refresh ถ้าเหลืออายุ < 1 ชม.
          if (!row.access_expires_at || Date.parse(row.access_expires_at) - Date.now() < 3600_000) {
            const t = await refreshAccessToken(dec(row.refresh_token))
            accessToken = t.access_token
            await upsertToken({
              shop_id: row.shop_id,
              access_token: enc(t.access_token), access_expires_at: new Date((t.access_token_expire_in || 0) * 1000).toISOString(),
              refresh_token: enc(t.refresh_token || dec(row.refresh_token)), refresh_expires_at: new Date((t.refresh_token_expire_in || 0) * 1000).toISOString(),
            })
          }

          const sinceSec = row.last_sync_at
            ? Math.floor(Date.parse(row.last_sync_at) / 1000) - 3600 // -1 ชม. overlap
            : untilSec - hours * 3600

          const ids = await listOrderIds({ accessToken, shopCipher: row.shop_cipher, sinceSec, untilSec })
          let summary = { imported: 0, mapped: 0, skippedDup: 0, unmappedSamples: [] }
          if (ids.length) {
            const orders = await getOrderDetails({ accessToken, shopCipher: row.shop_cipher, ids })
            summary = await ingestOrders(ordersToRows(orders), {
              platform: 'TikTok Shop', businessDefault: row.shop_name || '', fileName: `tiktok-sync:${row.shop_name || row.shop_id}`,
            })
          }
          await upsertToken({ shop_id: row.shop_id, last_sync_at: new Date().toISOString() })
          results.push({ shop: row.shop_name, orders_found: ids.length, imported: summary.imported, mapped: summary.mapped, skippedDup: summary.skippedDup, unmapped: summary.unmappedSamples.length })
        } catch (e) {
          results.push({ shop: row.shop_name, error: e.message })
        }
      }

      // log รวมไว้ดูย้อนหลัง (แท็บเดียวกับ cron อื่น ๆ ก็ได้ แต่แยกไว้ให้ชัด)
      try {
        await ensureSheet('tiktok_sync_runs', ['at', 'results'])
        await appendRows('tiktok_sync_runs', [[new Date().toISOString(), JSON.stringify(results)]])
      } catch { /* ignore */ }

      return res.status(200).json({ success: true, results })
    }

    return res.status(400).json({ success: false, error: 'unknown action' })
  } catch (e) {
    console.error('api/tiktok:', e.message)
    if (action === 'callback' || action === 'authorize') return res.status(500).send(htmlPage('เกิดข้อผิดพลาด', `<pre>${e.message}</pre>`))
    return res.status(500).json({ success: false, error: e.message })
  }
}
