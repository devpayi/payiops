// Pure parser for the isolated trial. Does not import any production API or credentials.
import { isoDate } from '../../shared/dates.js';
import { HEADERS, normalize, ImportError } from './orders-upload-store.mjs';

const key = x => String(x).trim().toLowerCase().replace(/\s+/g, ' ');
const fields = {
  order_id: ['order_id', 'order id', 'order sn', 'เลขที่คำสั่งซื้อ', 'หมายเลขคำสั่งซื้อ', 'ordernumber'],
  order_item_id: ['order_item_id', 'order item id', 'orderitemid', 'item id'],
  date: ['date', 'created time', 'create time', 'createtime', 'order creation date', 'order creation time', 'วันที่ทำการสั่งซื้อ', 'วันเวลาที่ทำการสั่งซื้อ', 'เวลาที่สั่งซื้อ'],
  sku_platform: ['sku_platform', 'seller sku', 'sellersku', 'sku reference no.', 'เลขอ้างอิง sku (sku reference no.)', 'sku'],
  product_name: ['product_name', 'product name', 'itemname', 'ชื่อสินค้า'],
  variation_name: ['variation_name', 'variation', 'variation name', 'sku name', 'ชื่อตัวเลือก', 'ประเภทสินค้า'],
  qty: ['qty', 'quantity', 'จำนวน', 'amount'],
  order_status: ['order_status', 'order status', 'status', 'สถานะการสั่งซื้อ', 'สถานะคำสั่งซื้อ', 'สถานะ'],
  province: ['province', 'จังหวัด'],
  shipping_option: ['shipping_option', 'ตัวเลือกการจัดส่ง', 'delivery option', 'deliverytype'],
  fulfillment_type: ['fulfillment_type', 'fulfillment type', 'fulfillmenttype'],
};
const lineMoney = {
  Shopee: ['revenue', 'ราคาขายสุทธิ', 'sku subtotal after discount'],
  'TikTok Shop': ['revenue', 'sku subtotal after discount'],
  Lazada: ['revenue', 'paidprice', 'paid price'],
};
function get(row, names) {
  const entries = new Map(Object.entries(row).map(([k,v]) => [key(k),v]));
  for (const name of names) if (entries.has(key(name))) return entries.get(key(name));
  return '';
}
export function parseTrialRows(input, { platform, business, fileName = 'trial' }) {
  if (!lineMoney[platform] || typeof business !== 'string' || !business.trim()) throw new ImportError('INVALID','เลือกแพลตฟอร์มและธุรกิจให้ครบ');
  if (!Array.isArray(input) || !input.length || input.length > 100000) throw new ImportError('INVALID','ไฟล์ต้องมี 1–100,000 แถว');
  const counter = new Map(), counts = new Map();
  for (const row of input) {
    if (!row || Array.isArray(row) || typeof row !== 'object') throw new ImportError('INVALID','รูปแบบแถวไม่ถูกต้อง');
    const id=String(get(row,fields.order_id)); counts.set(id,(counts.get(id)||0)+1);
  }
  let unmapped=0, excluded=0, cents=0, units=0;
  const rows=input.map((raw,index) => {
    try {
      const d=Object.fromEntries(HEADERS.map(h => [h,get(raw,[h])]));
      const normalizedInput=Object.keys(raw).includes('order_key');
      if (!normalizedInput) {
        for (const [field,names] of Object.entries(fields)) d[field]=get(raw,names);
        d.date=isoDate(d.date);
        if (!d.order_id || !d.date || !d.product_name || d.qty === '' || !d.order_status) throw new Error('ขาดรหัสออเดอร์ วันที่ ชื่อสินค้า จำนวน หรือสถานะ');
        d.revenue=get(raw,lineMoney[platform]);
        if (d.revenue === '') {
          d.revenue=get(raw,['order amount', 'ยอดรวม']);
          if (d.revenue === '' || counts.get(String(d.order_id)) !== 1) throw new Error('ไม่พบยอดต่อรายการที่ชัดเจน ห้ามใช้ยอดทั้งออเดอร์ซ้ำหลายสินค้า');
        }
        d.platform=platform; d.business=business;
        if (!d.order_item_id) {
          const n=(counter.get(String(d.order_id))||0)+1; counter.set(String(d.order_id),n); d.order_item_id=`L${n}`;
        }
        d.order_key=`${platform}:${d.order_id}:${d.order_item_id}`;
        d.display_name=d.display_name || d.product_name;
        d.source_file=fileName;
      }
      if (d.platform !== platform || d.business !== business) throw new Error('แพลตฟอร์ม/ธุรกิจในไฟล์ไม่ตรงที่เลือก ให้แยกไฟล์ตามช่องทางก่อน');
      const row=HEADERS.map(h => d[h]), r=normalize(row);
      if (!d.master_sku) unmapped++;
      if (r.excluded) excluded++; else { cents+=r.cents; units+=r.qty; }
      return row;
    } catch (e) { throw new ImportError('INVALID',`แถว ${index+2}: ${e.message}`); }
  });
  return { rows, summary: { rows:rows.length, cents, units, excluded, unmapped }, sample:rows.slice(0,8) };
}
