import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignOrderLines, pick, ORDER_ID_KEYS, ORDER_ITEM_ID_KEYS, DATE_KEYS, LINE_FIELD } from '../shared/orderLines.js'
import { isoDate } from '../shared/dates.js'

// จำลองตัวนับเดิมของ api/import-orders.js (นับใหม่ทุก request) — ใช้เทียบว่า key ไม่เปลี่ยน
function oldServerKeys(rows) {
  const counter = new Map()
  const out = []
  for (const row of rows) {
    const orderId = String(pick(row, ORDER_ID_KEYS) || '')
    let itemId = String(pick(row, ORDER_ITEM_ID_KEYS) || '')
    if (!orderId || !isoDate(pick(row, DATE_KEYS))) continue
    if (!itemId && row[LINE_FIELD]) itemId = row[LINE_FIELD]
    if (!itemId) { const n = (counter.get(orderId) || 0) + 1; counter.set(orderId, n); itemId = `L${n}` }
    out.push(`${orderId}:${itemId}`)
  }
  return out
}
const inBatches = (rows, size) => { const b = []; for (let i = 0; i < rows.length; i += size) b.push(rows.slice(i, i + size)); return b }
const shopee = (id, sku, date = '2026-08-03 10:00') => ({ 'หมายเลขคำสั่งซื้อ': id, 'วันที่ทำการสั่งซื้อ': date, 'เลขอ้างอิง SKU (SKU Reference No.)': sku })

const file = [shopee('A', 'PY001'), shopee('B', 'PY049'), shopee('B', 'PY006'), shopee('C', 'PY010'), shopee('A', 'PY002')]

test('ไฟล์เดียวไม่แบ่ง batch: key เหมือนตัวนับเดิมทุกตัว', () => {
  assert.deepEqual(oldServerKeys(assignOrderLines(file)), oldServerKeys(file))
})

test('ออเดอร์คร่อม batch: ตัวเดิมชน L1, ตัวใหม่ได้ L1/L2', () => {
  const oldKeys = inBatches(file, 2).flatMap(oldServerKeys)
  assert.equal(oldKeys.filter((k) => k === 'B:L1').length, 2) // บั๊กเดิม
  const newKeys = inBatches(assignOrderLines(file), 2).flatMap(oldServerKeys)
  assert.deepEqual(newKeys, oldServerKeys(file))
  assert.equal(new Set(newKeys).size, newKeys.length)
})

test('มี item id จริงอยู่แล้ว ไม่แตะ', () => {
  const rows = [{ orderNumber: 'X', createTime: '2026-08-01', orderItemId: '111' }]
  assert.equal(assignOrderLines(rows)[0][LINE_FIELD], undefined)
})

test('แถวไม่มีวันที่ ไม่นับ (เหมือนเดิม)', () => {
  const rows = [shopee('A', 'PY001', ''), shopee('A', 'PY002')]
  assert.equal(assignOrderLines(rows)[1][LINE_FIELD], 'L1')
})

test('ไม่แก้ object ต้นฉบับ', () => {
  const rows = [shopee('A', 'PY001')]
  assignOrderLines(rows)
  assert.equal(rows[0][LINE_FIELD], undefined)
})
