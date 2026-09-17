// อัพโหลดไฟล์เข้า Google Drive ของบอสเอง ผ่าน Google Apps Script Web App
// (ตั้งเอง — ดูวิธีใน backend/hide หรือถามผู้ดูแล) แทนที่จะใช้ Service Account โดยตรง
// เพราะ Service Account ไม่มีโควต้าเก็บไฟล์เป็นของตัวเอง (ทดสอบจริงแล้ว 2026-09-17 —
// "Service Accounts do not have storage quota" แม้โฟลเดอร์จะแชร์ Editor ให้ก็ตาม)
// Apps Script รันในนามบัญชี Google ของบอส (Execute as: Me) จึงมีโควต้าจริงให้ใช้ฟรี
export async function uploadToDrive({ folderId, fileName, mimeType, base64Data }) {
  const url = (process.env.APPS_SCRIPT_DRIVE_URL || '').trim()
  const secret = (process.env.APPS_SCRIPT_DRIVE_SECRET || '').trim()
  if (!url || !secret) return { success: false, error: 'APPS_SCRIPT_DRIVE_URL/SECRET ยังไม่ได้ตั้งค่า' }
  if (!folderId || !base64Data) return { success: false, error: 'ไม่มีไฟล์หรือโฟลเดอร์ปลายทาง' }
  try {
    const r = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ secret, folderId, fileName, mimeType, base64Data }),
    })
    return await r.json()
  } catch (e) {
    return { success: false, error: e.message }
  }
}
