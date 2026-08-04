// ระบบยืนยันตัวตนรายบัญชี — token แบบ HMAC-signed (ไม่มี session store, เหมาะกับ serverless)
// - เปิด/ปิดด้วย env AUTH_SECRET: ไม่ตั้ง = ไม่บังคับ auth (dev ในเครื่อง)
// - บน Vercel ต้องตั้ง AUTH_SECRET (สุ่มยาวๆ เดายาก) — ใช้เซ็น token ตอน login
// - ผู้ใช้เก็บในแท็บ `users` ของชีต จัดการผ่าน /api/auth (login / setup / create-user)
// guard ใช้เป็นบรรทัดแรกของทุก handler: if (!requireAuth(req, res)) return
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { canManageMarketing, canManageOperations, isDev, normalizeRole } from '../../shared/roles.js'

const b64u = (buf) => Buffer.from(buf).toString('base64url')
const fromB64u = (s) => Buffer.from(String(s), 'base64url')
// Increment to revoke every token issued by an older deployment.
const SESSION_VERSION = 2

export const authEnabled = () => Boolean(process.env.AUTH_SECRET)

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 32).toString('hex')
  return { salt, hash }
}

export function verifyPassword(password, salt, expectedHash) {
  try {
    const got = scryptSync(String(password), String(salt), 32)
    const exp = Buffer.from(String(expectedHash), 'hex')
    return got.length === exp.length && timingSafeEqual(got, exp)
  } catch { return false }
}

// token = base64url(payload JSON).base64url(HMAC-SHA256)
export function signToken(payload, days = 30) {
  const body = b64u(JSON.stringify({ ...payload, sv: SESSION_VERSION, exp: Date.now() + days * 86400000 }))
  const sig = createHmac('sha256', process.env.AUTH_SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyToken(token) {
  try {
    const [body, sig] = String(token || '').split('.')
    if (!body || !sig) return null
    const expect = createHmac('sha256', process.env.AUTH_SECRET).update(body).digest()
    const got = fromB64u(sig)
    if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null
    const payload = JSON.parse(fromB64u(body).toString())
    if (!payload.exp || Date.now() > payload.exp) return null
    if (payload.sv !== SESSION_VERSION) return null
    return payload
  } catch { return null }
}

// ค่า Cache-Control ที่ปลอดภัย: ถ้าเปิด auth ห้าม cache แบบ public ที่ CDN
// (ไม่งั้น response ที่ login แล้วถูก cache ไว้ จะถูกเสิร์ฟให้คนไม่มี token ได้ = ข้อมูลรั่ว)
export const cacheable = (value) => (authEnabled() ? 'no-store' : value)

export function requireAuth(req, res) {
  if (!authEnabled()) return true // โหมดเปิด (local dev)
  const user = verifyToken(req.headers['x-api-token'])
  if (!user) {
    res.status(401).json({ success: false, error: 'unauthorized' })
    return false
  }
  req.user = user // ให้ endpoint รู้ว่าใครเรียก (username/role)
  req.user.role = normalizeRole(req.user.role)
  return true
}

export function requireDev(req, res) {
  if (!requireAuth(req, res)) return false
  if (authEnabled() && !isDev(req.user?.role)) {
    res.status(403).json({ success: false, error: 'ส่วนนี้สำหรับ Dev เท่านั้น' })
    return false
  }
  return true
}

export function requireManager(req, res) {
  if (!requireAuth(req, res)) return false
  if (authEnabled() && !canManageOperations(req.user?.role)) {
    res.status(403).json({ success: false, error: 'ส่วนนี้สำหรับ Boss หรือ Dev เท่านั้น' })
    return false
  }
  return true
}

// เหมือน requireManager แต่เปิดให้ role marketing เข้าเขียนได้ด้วย — ใช้เฉพาะ endpoint ของ Marketing
// Radar (marketingEvents.js/marketingBasket.js) ไม่ใช้กับ marketingInputs.js (Ads & Channels ยังเป็น
// Boss/Dev เท่านั้น เพราะ role marketing ไม่ได้ขอสิทธิ์หน้านั้น)
export function requireMarketingManager(req, res) {
  if (!requireAuth(req, res)) return false
  if (authEnabled() && !canManageMarketing(req.user?.role)) {
    res.status(403).json({ success: false, error: 'ส่วนนี้สำหรับ Boss, Dev หรือ Marketing เท่านั้น' })
    return false
  }
  return true
}
