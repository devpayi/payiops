// POST /api/claims-import  body: { fileName, rows: [ {..excel row..} ] }
// map แถวจาก Excel เข้า sheet "claims" + จับคู่ master_sku ผ่าน product_aliases
import { requireAuth } from './_lib/auth.js'
import { getSheet, appendRows, ensureSheet } from './_lib/sheets.js'
import { isoDate } from './_lib/dates.js'
import { buildClaimAliasLookup, resolveClaimAlias } from './_lib/claimMapping.js'
import { findDuplicateImport, hasMeaningfulClaimRow, sourceFileRef } from './_lib/claimImport.js'
import { CLAIMS_HEADERS } from './_lib/claimsSchema.js'

const normalize = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const truthy = (v) => {
  const s = String(v ?? '').trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'x' || s === '✓' || s === 'y'
}

// ดึงค่าจาก object โดยลองหลายชื่อคอลัมน์ (รองรับหัวตารางไทย/อังกฤษ)
function pick(row, keys) {
  for (const k of Object.keys(row)) {
    const nk = normalize(k)
    if (keys.some((cand) => nk === normalize(cand) || nk.includes(normalize(cand)))) return row[k]
  }
  return ''
}

function genImportId() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `IMP${stamp}-${rand}`
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
  const { fileName = '', fileHash = '', rows } = req.body || {}
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลในไฟล์' })

  try {
    // สร้าง lookup จาก product_aliases:
    // - ชื่อสินค้า + variation -> SKU ใช้เป็นหลัก เพราะชื่อยาวซ้ำข้ามไซซ์/สีได้
    // - ชื่อสินค้าอย่างเดียว -> ใช้เฉพาะกรณีไม่กำกวม
    let aliasLookup = buildClaimAliasLookup()
    try {
      const aliases = await getSheet('product_aliases')
      aliasLookup = buildClaimAliasLookup(aliases)
    } catch { /* ไม่มี tab product_aliases ก็ข้าม */ }

    const importId = String(req.body.importId || '') || genImportId()
    await ensureSheet('claims', CLAIMS_HEADERS)
    const existing = await getSheet('claims')
    const duplicate = findDuplicateImport(existing, { fileName, fileHash, importId })
    if (duplicate && !req.body.allowDuplicate) return res.status(409).json({ success: false, duplicate: true, error: 'ไฟล์นี้เคยนำเข้าแล้ว', existingImportId: duplicate.import_id })
    const importedAt = new Date().toISOString()
    const sourceRef = sourceFileRef(fileName, fileHash)
    let mapped = 0, fuzzyMapped = 0, skippedInvalid = 0
    const unmappedSamples = []
    const skippedSamples = []
    const out = rows.filter(hasMeaningfulClaimRow).map((row, index) => {
      const dateRaw = pick(row, ['date', 'วันที่'])
      const date = isoDate(dateRaw)
      if (!date) {
        skippedInvalid++
        if (skippedSamples.length < 5) skippedSamples.push({ dateRaw, dateRawType: typeof dateRaw })
        return null
      }
      const productName = pick(row, ['product_name', 'ชื่อสินค้า', 'สินค้า', 'product'])
      const variation = pick(row, ['alias_variation', 'variation_name', 'variation', 'ตัวเลือกสินค้า', 'ประเภทสินค้า', 'แบบ', 'ไซซ์', 'ขนาด', 'สี'])
      const sourceSku = pick(row, ['master_sku', 'sku_platform', 'seller_sku', 'sku', 'รหัสสินค้า', 'รหัส sku'])
      const alias = resolveClaimAlias(aliasLookup, productName, variation, sourceSku)
      if (alias) { mapped++; if (alias.match_method === 'fuzzy') fuzzyMapped++ }
      else if (productName && unmappedSamples.length < 20 && !unmappedSamples.includes(productName)) unmappedSamples.push(productName)
      return [
        date,
        pick(row, ['business', 'ธุรกิจ', 'แบรนด์', 'brand']),
        productName,
        pick(row, ['free_item', 'ของแถม', 'สินค้าที่แถม', 'เสียฟรี']),
        num(pick(row, ['claim_value', 'มูลค่า', 'มูลค่าเคลม', 'value'])),
        truthy(pick(row, ['is_damaged', 'เสียหาย', 'พัง', 'damaged'])) ? '1' : '',
        truthy(pick(row, ['is_incomplete', 'ส่งไม่ครบ', 'ไม่ครบ', 'incomplete'])) ? '1' : '',
        truthy(pick(row, ['is_wrong_item', 'ส่งผิด', 'ผิด', 'wrong'])) ? '1' : '',
        pick(row, ['note', 'หมายเหตุ', 'remark']),
        alias?.master_sku || '',
        alias?.display_name || productName,
        importedAt,
        importId,
        sourceRef,
        `claim-${importId}-${index}`,
      ]
    }).filter(Boolean)

    await appendRows('claims', out)
    res.status(200).json({ success: true, importId, rowsImported: out.length, mappedCount: mapped, fuzzyMappedCount: fuzzyMapped, unmappedCount: out.length - mapped, unmappedSamples, skippedInvalid, skippedSamples })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
}

function num(v) { return parseFloat(String(v ?? '').replace(/,/g, '')) || 0 }
