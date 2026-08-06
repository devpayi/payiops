// LINE Messaging API helper — push (แจ้งเตือนคำขอลาใหม่) + reply (ยืนยันหลังกดปุ่ม) + ตรวจลายเซ็น webhook
// ต้องตั้ง env LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET (ทั้งใน .env และบน Vercel)
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifySignature(rawBody, signatureHeader) {
  const secret = process.env.LINE_CHANNEL_SECRET
  if (!secret || !signatureHeader) return false
  try {
    const expect = createHmac('sha256', secret).update(rawBody || '').digest()
    const got = Buffer.from(String(signatureHeader), 'base64')
    return expect.length === got.length && timingSafeEqual(expect, got)
  } catch { return false }
}

async function callLineApi(path, body) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return { ok: false, error: 'LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า' }
  try {
    const res = await fetch(`https://api.line.me${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) return { ok: false, error: `LINE API ${res.status}: ${await res.text().catch(() => '')}` }
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
}

export const pushMessage = (to, messages) => callLineApi('/v2/bot/message/push', { to, messages })
export const replyMessage = (replyToken, messages) => callLineApi('/v2/bot/message/reply', { replyToken, messages })

// ── Rich menu ──────────────────────────────────────────────────────────────
// สร้างเมนู 1 อัน (JSON structure ล้วน ยังไม่มีรูป) — คืน richMenuId ถ้าสำเร็จ ใช้ id นี้ต่อตอนอัพโหลด
// รูป/ผูกกับ user คนใดคนหนึ่ง (linkRichMenuToUser) หรือตั้งเป็น default ของทุกคน (setDefaultRichMenu)
export async function createRichMenu(menu) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return { ok: false, error: 'LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า' }
  try {
    const res = await fetch('https://api.line.me/v2/bot/richmenu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(menu),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: `LINE API ${res.status}: ${JSON.stringify(data)}` }
    return { ok: true, richMenuId: data.richMenuId }
  } catch (e) { return { ok: false, error: e.message } }
}

// อัพโหลดรูปเข้าเมนูที่สร้างไว้แล้ว — endpoint นี้คนละ host กับ API ทั่วไป (api-data.line.me ไม่ใช่ api.line.me)
// และเป็น body รูปดิบ (Buffer) ไม่ใช่ JSON เหมือนฟังก์ชันอื่นในไฟล์นี้ เลยเขียนแยก ไม่ใช้ callLineApi
export async function uploadRichMenuImage(richMenuId, imageBuffer, contentType = 'image/png') {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return { ok: false, error: 'LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า' }
  try {
    const res = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, Authorization: `Bearer ${token}` },
      body: imageBuffer,
    })
    if (!res.ok) return { ok: false, error: `LINE API ${res.status}: ${await res.text().catch(() => '')}` }
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
}

// ผูกเมนูนี้ให้ user คนเดียว (ไว้แยก tier ตาม role) — เขียนทับเมนูเดิมที่ user คนนี้เคยผูกไว้ (ถ้ามี) ไม่ต้อง unlink ก่อน
export async function linkRichMenuToUser(userId, richMenuId) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return { ok: false, error: 'LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า' }
  try {
    const res = await fetch(`https://api.line.me/v2/bot/user/${userId}/richmenu/${richMenuId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return { ok: false, error: `LINE API ${res.status}: ${await res.text().catch(() => '')}` }
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
}

// ตั้งเป็นเมนู default ของทุกคนที่ยังไม่เคยผูกเมนูเฉพาะตัวไว้ — ใช้ตอน setup ครั้งแรก (คนที่ยังไม่ resolve
// role ได้ เช่น ยังไม่ได้ผูกบัญชี จะได้เห็นเมนู staff/general แทนไม่มีเมนูเลย)
export async function setDefaultRichMenu(richMenuId) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return { ok: false, error: 'LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า' }
  try {
    const res = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return { ok: false, error: `LINE API ${res.status}: ${await res.text().catch(() => '')}` }
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
}

export async function deleteRichMenu(richMenuId) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return { ok: false, error: 'LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า' }
  try {
    const res = await fetch(`https://api.line.me/v2/bot/richmenu/${richMenuId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return { ok: false, error: `LINE API ${res.status}: ${await res.text().catch(() => '')}` }
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
}

export async function listRichMenus() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return { ok: false, error: 'LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า' }
  try {
    const res = await fetch('https://api.line.me/v2/bot/richmenu/list', { headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: `LINE API ${res.status}: ${JSON.stringify(data)}` }
    return { ok: true, richmenus: data.richmenus || [] }
  } catch (e) { return { ok: false, error: e.message } }
}
