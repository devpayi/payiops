// GET /api/sheet-tools?op=demographic&view=province — สรุปยอดขายตามจังหวัด จาก raw_orders_* (คอลัมน์ province)
// dev/boss/marketing เท่านั้น — เหมือน pattern ของ cfo.js
// อ่าน 2 ช่วงต่อ tab: B:B = order_id ; D:V = date(0) platform(1) ... master_sku(6) display_name(7)
//   qty(8) revenue(9) order_status(10) ... province(15) shipping_option(16) fulfillment_type(17) buyer_hash(18)
import { getMetaCached, batchGetValues, getSheet } from './sheets.js'
import { shopeeShippingOption, isFastShopeeOption } from './shippingClass.js'
import { deriveGroup, buildOverrideMap } from './productGroup.js'
import { normalizeProvince } from './provinceNormalize.js'

const MIN_PRODUCT_ORDERS = 20   // ตัดหางยาว — โชว์เฉพาะกลุ่มสินค้าที่มีออเดอร์ Shopee (มี label จัดส่ง) ตั้งแต่นี้ขึ้นไป

const num = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const isCancelled = (s = '') => String(s).includes('ยกเลิก') || String(s).toLowerCase().includes('cancel')

export default async function opDemographic(req, res) {
  try {
    const meta = await getMetaCached()
    const tabs = meta.sheets.map((s) => s.properties.title).filter((t) => t.startsWith('raw_orders'))
    if (!tabs.length) return res.status(200).json({ success: true, provinces: [], totalOrders: 0, withProvince: 0, shopeeShipping: [], shopeeTotal: 0, shopeeWithOption: 0, shopeeShippingByProduct: [], repeatByPlatform: [] })

    let overrideMap = new Map()
    try { overrideMap = buildOverrideMap(await getSheet('product_aliases')) } catch { /* ไม่มี override ก็ข้าม */ }

    const vr = await batchGetValues(tabs.flatMap((t) => [`${t}!B:B`, `${t}!D:V`]))
    const byProvince = new Map()
    let totalOrders = 0, withProvince = 0
    // Shopee เท่านั้น — นับตามชื่อประเภทการจัดส่ง (verbatim จากคอลัมน์)
    const shopeeByOption = new Map()
    let shopeeTotal = 0, shopeeWithOption = 0
    // Shopee เท่านั้น — % ด่วน/ธรรมดา แยกตามกลุ่มสินค้า (deriveGroup)
    const shopeeByProduct = new Map()
    // ลูกค้าซื้อซ้ำ — นับราย order_id (dedupe line item) แยกตามแพลตฟอร์ม
    const seenOrder = new Set()          // `${platform}:${orderId}` ที่นับ order แล้ว (มี buyer_hash)
    const seenAnyOrder = new Set()       // `${platform}:${orderId}` ทั้งหมด — ตัวหาร coverage
    const platformOrderCount = new Map() // platform -> จำนวน order ทั้งหมด (distinct)
    const buyerOrders = new Map()        // platform -> Map(hash -> จำนวน order distinct ของลูกค้าคนนั้น)

    for (let i = 0; i < tabs.length; i++) {
      const idRows = vr[i * 2].values || []
      const rows = vr[i * 2 + 1].values || []
      for (let j = 1; j < rows.length; j++) {
        const r = rows[j] || []
        const orderId = String((idRows[j] || [])[0] || '').replace(/^'/, '').trim()
        const date = r[0]
        const platform = String(r[1] || '').trim()
        const qty = num(r[8])
        const status = r[10]
        const province = normalizeProvince(r[15])
        const buyerHash = String(r[18] || '').trim()
        if (!date || isCancelled(status)) continue
        totalOrders++

        if (platform && orderId) {
          const pKey = `${platform}:${orderId}`
          if (!seenAnyOrder.has(pKey)) {
            seenAnyOrder.add(pKey)
            platformOrderCount.set(platform, (platformOrderCount.get(platform) || 0) + 1)
          }
          if (buyerHash && !seenOrder.has(pKey)) {
            seenOrder.add(pKey)
            if (!buyerOrders.has(platform)) buyerOrders.set(platform, new Map())
            const bm = buyerOrders.get(platform)
            bm.set(buyerHash, (bm.get(buyerHash) || 0) + 1)
          }
        }

        if (platform.toLowerCase().includes('shopee')) {
          shopeeTotal++
          const opt = shopeeShippingOption(r[16], platform)
          if (opt) {
            shopeeWithOption++
            const e = shopeeByOption.get(opt) || { option: opt, orders: 0, units: 0 }
            e.orders++
            e.units += qty
            shopeeByOption.set(opt, e)

            const { key, label } = deriveGroup(r[7], r[6], overrideMap)
            const g = shopeeByProduct.get(key) || { label, orders: 0, fast: 0, normal: 0 }
            g.orders++
            if (isFastShopeeOption(opt)) g.fast++
            else g.normal++
            shopeeByProduct.set(key, g)
          }
        }

        if (!province) continue
        withProvince++
        const p = byProvince.get(province) || { province, orders: 0, units: 0 }
        p.orders++
        p.units += qty
        byProvince.set(province, p)
      }
    }

    const provinces = [...byProvince.values()].sort((a, b) => b.orders - a.orders)
    const shopeeShipping = [...shopeeByOption.values()].sort((a, b) => b.orders - a.orders)
    const shopeeShippingByProduct = [...shopeeByProduct.values()]
      .filter((g) => g.orders >= MIN_PRODUCT_ORDERS)
      .map((g) => ({ ...g, fastPct: Math.round((g.fast / g.orders) * 1000) / 10 }))
      .sort((a, b) => b.fastPct - a.fastPct || b.orders - a.orders)
    const repeatByPlatform = [...buyerOrders.entries()].map(([platform, bm]) => {
      const counts = [...bm.values()]
      const buyers = counts.length
      const ordersWithBuyer = counts.reduce((a, c) => a + c, 0)
      const repeatBuyers = counts.filter((c) => c >= 2).length
      const repeatOrders = ordersWithBuyer - buyers   // ออเดอร์ที่ 2+ ของแต่ละคน
      const platOrders = platformOrderCount.get(platform) || 0
      return {
        platform, buyers, ordersWithBuyer, repeatBuyers, repeatOrders,
        repeatOrderPct: ordersWithBuyer ? Math.round((repeatOrders / ordersWithBuyer) * 1000) / 10 : 0,
        repeatBuyerPct: buyers ? Math.round((repeatBuyers / buyers) * 1000) / 10 : 0,
        coveragePct: platOrders ? Math.round((ordersWithBuyer / platOrders) * 100) : 0,
      }
    }).sort((a, b) => b.ordersWithBuyer - a.ordersWithBuyer)

    return res.status(200).json({
      success: true, provinces, totalOrders, withProvince,
      shopeeShipping, shopeeTotal, shopeeWithOption, shopeeShippingByProduct,
      repeatByPlatform,
    })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
}
