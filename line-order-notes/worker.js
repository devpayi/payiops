/**
 * Cloudflare Worker — proxy หน้า Apps Script
 * แก้ปัญหา Apps Script web app ตอบ 302 เสมอ (LINE ไม่ follow redirect ให้ จึง verify ไม่ผ่าน)
 * โดย fetch ไป Apps Script ด้วย redirect:'manual' แล้วไม่สนใจ redirect ที่ได้กลับมาเลย —
 * ตัวสคริปต์ (บันทึกชีต + ตอบไลน์) รันจบไปแล้วตั้งแต่ request แรกที่ยิงถึง /exec
 * ตัว 302 เป็นแค่ทางส่ง "ข้อความตอบ" ของ Apps Script เองซึ่งเราไม่ได้ใช้ ไม่ต้อง fetch ตามอีกรอบ
 * (เคย fetch ตามไปรอบสองแล้วพบว่าช้าจน LINE ตัดการเชื่อมต่อก่อน — "outcome":"canceled")
 *
 * ยังตรวจลายเซ็น X-Line-Signature (HMAC-SHA256) ที่นี่ด้วย เพราะ Worker เห็น
 * HTTP header จริง (ต่างจาก Apps Script doPost ที่มองไม่เห็น header เลย)
 *
 * ตั้งค่า (Cloudflare dashboard > Worker นี้ > Settings > Variables and Secrets):
 *   CHANNEL_SECRET   = LINE channel secret (ตั้งเป็น Secret ไม่ใช่ Variable ธรรมดา)
 *   APPS_SCRIPT_URL  = URL /exec ของ Apps Script deployment
 */

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('ok');

    const bodyText = await request.text();
    const signature = request.headers.get('x-line-signature') || '';
    const valid = await verifySignature_(env.CHANNEL_SECRET, bodyText, signature);
    if (!valid) return new Response('invalid signature', { status: 401 });

    const forward = fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyText,
      redirect: 'manual',
    }).catch(() => {});
    ctx.waitUntil(forward); // ยิงต่อแบบไม่รอ ตอบ LINE ทันทีไม่ให้ timeout

    return new Response('ok', { status: 200 });
  },
};

async function verifySignature_(secret, body, signatureBase64) {
  if (!secret || !signatureBase64) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const computed = base64_(mac);
  return computed === signatureBase64;
}

function base64_(buffer) {
  let binary = '';
  new Uint8Array(buffer).forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}
