// tiktokApi — client บางๆ สำหรับ TikTok Shop Open API (เวอร์ชัน 202309)
//
// ทำเท่าที่ mona-ops ต้องใช้: แลก auth_code เป็น token, refresh token, list ร้านที่ authorize,
// ดึงรายการออเดอร์ (ตาม update_time) + รายละเอียดออเดอร์ แล้ว map เป็น "แถว" สำหรับ ingestOrders
//
// ENV ที่ต้องตั้งบน Vercel:
//   TIKTOK_APP_KEY, TIKTOK_APP_SECRET      — จากหน้า app (Basic Information)
//   TIKTOK_SERVICE_ID                       — "รหัสประจำตัว" ของ app (ใช้ทำลิงก์ authorize)
//   TIKTOK_API_BASE   (optional)            — default https://open-api.tiktokglobalshop.com
//   TIKTOK_AUTH_BASE  (optional)            — default https://auth.tiktok-shops.com
import { createHmac, createHash } from 'node:crypto'

const API_BASE = () => process.env.TIKTOK_API_BASE || 'https://open-api.tiktokglobalshop.com'
const AUTH_BASE = () => process.env.TIKTOK_AUTH_BASE || 'https://auth.tiktok-shops.com'
const APP_KEY = () => process.env.TIKTOK_APP_KEY || ''
const APP_SECRET = () => process.env.TIKTOK_APP_SECRET || ''
const SERVICE_ID = () => process.env.TIKTOK_SERVICE_ID || ''

const BUYER_PEPPER = 'payiops-buyer-v1'
const normalize = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
export const buyerHash = (name) => {
  const s = normalize(name)
  return s ? createHash('sha256').update(BUYER_PEPPER + s).digest('hex').slice(0, 16) : ''
}

// ลิงก์ที่ผู้ขายกดเพื่ออนุญาต app เข้าถึงร้าน — กดครั้งเดียวต่อร้าน แล้ว TikTok เด้งกลับมาที่ redirect URL
// ของ app พร้อม ?code=... (redirect URL ตั้งไว้ที่หน้า app = https://payiops.vercel.app/api/tiktok?action=callback)
export function authorizeUrl(state = '') {
  const u = new URL('https://services.tiktokshop.com/open/authorize')
  u.searchParams.set('service_id', SERVICE_ID())
  if (state) u.searchParams.set('state', state)
  return u.toString()
}

// ── การเซ็นคำขอ (เฉพาะ endpoint ใต้ open-api.* — token endpoint ไม่ต้องเซ็น) ──
// อัลกอ: เรียง query param (ไม่รวม sign, access_token) → ต่อเป็น key+value → นำหน้าด้วย path →
// ต่อ JSON body (ถ้ามี) → ครอบหน้า/หลังด้วย app_secret → HMAC-SHA256(app_secret) เป็น hex
function sign(path, query, bodyStr) {
  const keys = Object.keys(query).filter((k) => k !== 'sign' && k !== 'access_token').sort()
  let base = path + keys.map((k) => `${k}${query[k]}`).join('')
  if (bodyStr) base += bodyStr
  base = APP_SECRET() + base + APP_SECRET()
  return createHmac('sha256', APP_SECRET()).update(base).digest('hex')
}

async function callApi(method, path, { query = {}, body = null, accessToken = '' } = {}) {
  const q = { app_key: APP_KEY(), timestamp: String(Math.floor(Date.now() / 1000)), ...query }
  const bodyStr = body ? JSON.stringify(body) : ''
  q.sign = sign(path, q, bodyStr)
  const url = `${API_BASE()}${path}?${new URLSearchParams(q).toString()}`
  const headers = { 'content-type': 'application/json' }
  if (accessToken) headers['x-tts-access-token'] = accessToken
  const r = await fetch(url, { method, headers, body: bodyStr || undefined })
  const json = await r.json().catch(() => ({}))
  if (json.code !== 0) {
    throw new Error(`TikTok API ${path} → code ${json.code}: ${json.message || 'unknown'}`)
  }
  return json.data
}

// ── Token ──
async function tokenCall(pathname, params) {
  const u = new URL(`${AUTH_BASE()}${pathname}`)
  u.searchParams.set('app_key', APP_KEY())
  u.searchParams.set('app_secret', APP_SECRET())
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  const r = await fetch(u.toString(), { headers: { 'content-type': 'application/json' } })
  const json = await r.json().catch(() => ({}))
  if (json.code !== 0) throw new Error(`TikTok token ${pathname} → code ${json.code}: ${json.message || 'unknown'}`)
  return json.data
}

export function exchangeAuthCode(authCode) {
  return tokenCall('/api/v2/token/get', { auth_code: authCode, grant_type: 'authorized_code' })
}
export function refreshAccessToken(refreshToken) {
  return tokenCall('/api/v2/token/refresh', { refresh_token: refreshToken, grant_type: 'refresh_token' })
}

// ร้านที่ token นี้เข้าถึงได้ — ต้องใช้ shop_cipher ในการเรียก order API ต่อ
export async function getAuthorizedShops(accessToken) {
  const data = await callApi('GET', '/authorization/202309/shops', { accessToken })
  return data.shops || []
}

// ── Orders ──
// ดึง id ออเดอร์ที่ "อัปเดต" ในช่วง [sinceSec, untilSec) — วนทุกหน้า
export async function listOrderIds({ accessToken, shopCipher, sinceSec, untilSec }) {
  const ids = []
  let pageToken = ''
  for (let guard = 0; guard < 200; guard++) {
    const query = { shop_cipher: shopCipher, page_size: '50' }
    if (pageToken) query.page_token = pageToken
    const data = await callApi('POST', '/order/202309/orders/search', {
      query, accessToken,
      body: { update_time_ge: sinceSec, update_time_lt: untilSec },
    })
    for (const o of data.orders || []) ids.push(o.id)
    pageToken = data.next_page_token || ''
    if (!pageToken) break
  }
  return ids
}

// รายละเอียดออเดอร์ (ทีละ 50 id)
export async function getOrderDetails({ accessToken, shopCipher, ids }) {
  const out = []
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50)
    const data = await callApi('GET', '/order/202309/orders', {
      query: { shop_cipher: shopCipher, ids: batch.join(',') },
      accessToken,
    })
    for (const o of data.orders || []) out.push(o)
  }
  return out
}

// แปลงออเดอร์ TikTok → แถวสำหรับ ingestOrders (1 แถว = 1 line item)
// create_time / update_time เป็น unix วินาที (UTC) — บวก 7 ชม.ก่อนตัดวันที่ ให้ตรงกับไฟล์ export
// เดิมที่เป็นเวลาไทย (raw_orders group by เดือนด้วย slice ตำแหน่งคงที่)
export function ordersToRows(orders) {
  const rows = []
  for (const o of orders) {
    const created = Number(o.create_time || o.paid_time || 0)
    const date = created ? new Date((created + 7 * 3600) * 1000).toISOString().slice(0, 10) : ''
    const buyerHashVal = buyerHash(o.buyer_email || o.user_id || o.buyer_user_id || '')
    const shippingOption = o.delivery_option_name || o.shipping_provider_name || ''
    const fulfillmentType = o.fulfillment_type || ''
    const status = o.status || ''
    for (const li of o.line_items || []) {
      rows.push({
        order_id: o.id,
        order_item_id: li.id,               // unique ต่อชิ้น — 1 line item = 1 ชิ้น
        date,
        product_name: li.product_name || '',
        variation_name: li.sku_name || '',
        sku_platform: li.seller_sku || li.sku_id || '',
        qty: 1,
        revenue: li.sale_price != null ? li.sale_price : (li.original_price || 0),
        order_status: status,
        province: '',                       // ต้องขอ scope address แยก (ยังไม่ขอ) — เว้นว่างไว้ก่อน
        shipping_option: shippingOption,
        fulfillment_type: fulfillmentType,
        buyer_hash: buyerHashVal,
      })
    }
  }
  return rows
}

export const config = { hasCreds: () => Boolean(APP_KEY() && APP_SECRET() && SERVICE_ID()) }
