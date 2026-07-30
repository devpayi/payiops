import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import payiLogo from './assets/payi-logo.png'
import { canAccessTab, normalizeRole, STAFF_TABS, STOCK_TABS } from '../shared/roles.js'
import {
  Bell, Search, UserCircle2, ShoppingBag, Package, TrendingUp, Percent,
  AlertTriangle, AlertCircle, ArrowRight, X, Sparkles, TrendingDown, Loader2,
  LayoutDashboard, UploadCloud, Radar, Megaphone, CalendarClock, Boxes,
  ArrowLeftRight, Users, ShieldAlert, BookOpen, Link2,
  Code2, Settings as SettingsIcon, CalendarCheck, Menu, Ship,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from 'recharts'

const Upload = lazy(() => import('./pages/Upload'))
const LinksHub = lazy(() => import('./pages/LinksHub'))
const DevHub = lazy(() => import('./pages/DevHub'))
const ClaimView = lazy(() => import('./pages/ClaimView'))
const MonthlyDashboard = lazy(() => import('./pages/MonthlyDashboard'))
const PlannerControl = lazy(() => import('./pages/PlannerControl'))
const FeedProducts = lazy(() => import('./pages/FeedProducts'))
const WorkforceOT = lazy(() => import('./pages/WorkforceOT'))
const HR = lazy(() => import('./pages/HR'))
const ProductDashboard = lazy(() => import('./pages/ProductDashboard'))
const ProductTrends = lazy(() => import('./pages/ProductTrends'))
const MarketingRadar = lazy(() => import('./pages/MarketingRadar'))
const AdsChannels = lazy(() => import('./pages/AdsChannels'))
const ContentOSPrototype = lazy(() => import('./pages/ContentOSPrototype'))
const Inventory = lazy(() => import('./pages/Inventory'))
const StockMovement = lazy(() => import('./pages/StockMovement'))
const ImportTracking = lazy(() => import('./pages/ImportTracking'))
const Settings = lazy(() => import('./pages/Settings'))

const API_BASE = '/api'

const fmt = n => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 0 })

function ModuleFallback() {
  return (
    <div style={{ minHeight: 260, display: 'grid', placeItems: 'center', color: 'var(--payi-text-muted)', fontSize: 13 }}>
      กำลังโหลด...
    </div>
  )
}

// ─── CSV export helper ──────────────────────────────────────────────────
function exportToCsv(filename, rows) {
  if (!rows || rows.length === 0) return
  const headers = Object.keys(rows[0])
  const escapeCell = (val) => {
    const str = String(val ?? '')
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
    return str
  }
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(h => escapeCell(row[h])).join(','))
  ]
  const csvContent = '\uFEFF' + lines.join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

const PLATFORM_COLORS = { 'Shopee': '#E05D45', 'TikTok Shop': '#2D2D2D', 'Lazada': '#0F146D' }

// ============================================================
// CRISP SVG ICONS (MATCHING THE SCREENSHOT)
// ============================================================
// ไอคอนแยกตามแต่ละเมนูจริง (ก่อนหน้านี้บางไอคอนถูกใช้ซ้ำกันถึง 4 เมนู เช่น Tasks/StockMovement
// ทำให้แยกเมนูจากไอคอนไม่ออกตอน sidebar ย่อเหลือแต่ไอคอน) — ทุกเมนูมีไอคอนของตัวเอง ไม่ซ้ำกันเลย
const Icons = {
  Executive: LayoutDashboard,
  Products: Package,
  ImportOrders: UploadCloud,
  MarketingRadar: Radar,
  AdsChannels: Megaphone,
  ContentOS: Sparkles,
  PlannerControl: CalendarClock,
  Inventory: Boxes,
  StockMovement: ArrowLeftRight,
  ImportTracking: Ship,
  WorkforceOT: Users,
  HR: CalendarCheck,
  Claims: ShieldAlert,
  SOPs: BookOpen,
  LinksHub: Link2,
  DevHub: Code2,
  Settings: SettingsIcon,
}

const KNOWN_TABS = new Set([
  'Home', 'Executive', 'Monthly', 'FeedProducts', 'Products', 'ProductTrends',
  'AdsChannels', 'ContentOS', 'MarketingRadar', 'Planner Control', 'Inventory',
  'Import Tracking', 'Stock Movement', 'Workforce OT', 'HR', 'Claims',
  'Import Orders', 'Links Hub', 'Dev Hub', 'Settings',
])

const menuGroups = [
  {
    title: 'ภาพรวมธุรกิจ',
    items: [
      { id: 'Executive', label: 'Dashboard สรุปยอดขาย', renderIcon: Icons.Executive, group: ['Executive', 'Monthly'] },
      { id: 'Products', label: 'Dashboard สินค้า', renderIcon: Icons.Products, group: ['Products', 'ProductTrends'] }
    ]
  },
  {
    title: 'ยอดขายและการตลาด',
    items: [
      { id: 'Import Orders', label: 'Import Orders', renderIcon: Icons.ImportOrders, dotColor: 'var(--payi-success)' },
      { id: 'MarketingRadar', label: 'Marketing Radar', renderIcon: Icons.MarketingRadar, dotColor: 'var(--payi-mint)' },
      { id: 'AdsChannels', label: 'Ads & Channels', renderIcon: Icons.AdsChannels },
      { id: 'ContentOS', label: 'Content OS Prototype', renderIcon: Icons.ContentOS, dotColor: 'var(--payi-mint)' }
    ]
  },
  {
    title: 'วางแผนและปฏิบัติการ',
    items: [
      { id: 'Inventory', label: 'Inventory', renderIcon: Icons.Inventory, dotColor: 'var(--payi-danger)' },
      { id: 'Stock Movement', label: 'Stock Movement', renderIcon: Icons.StockMovement },
      { id: 'Import Tracking', label: 'ติดตามนำเข้า', renderIcon: Icons.ImportTracking, dotColor: '#0ea5e9' },
      { id: 'Planner Control', label: 'Planner Control', renderIcon: Icons.PlannerControl, dotColor: '#8b5cf6', group: ['Planner Control', 'FeedProducts'] },
      { id: 'Workforce OT', label: 'Manpower & OT', renderIcon: Icons.WorkforceOT, dotColor: '#7dd3fc' },
      { id: 'HR', label: 'พนักงาน (ลา)', renderIcon: Icons.HR, dotColor: '#a78bfa' },
      { id: 'Claims', label: 'Claims', renderIcon: Icons.Claims }
    ]
  },
  {
    title: 'คู่มือและเครื่องมือ',
    items: [
      { id: 'SOPs', label: 'SOPs', renderIcon: Icons.SOPs },
      { id: 'Links Hub', label: 'Links Hub', helper: 'Boss / Manager', renderIcon: Icons.LinksHub },
      { id: 'Dev Hub', label: 'Dev Hub', helper: 'Dev / New joiner', renderIcon: Icons.DevHub }
    ]
  },
  {
    title: 'ระบบ',
    items: [
      { id: 'Settings', label: 'Settings', renderIcon: Icons.Settings }
    ]
  }
]

// bottom tab bar มือถือ — 4 อันที่ใช้บ่อยสุด (พื้นที่นิ้วโป้งจำกัด) ที่เหลือเข้าถึงผ่านปุ่ม "เมนู" (sheet เต็ม visibleMenuGroups)
// ใช้เฉพาะ role ที่เห็นแท็บเยอะ (boss/dev/staff) — role แคบๆ ที่เห็นแค่ไม่กี่แท็บ (เช่น stock)
// ใช้ทุกแท็บที่ตัวเองเห็นตรงๆ แทน ไม่ต้องมีปุ่ม "เมนู" เลย ดู MOBILE_TAB_LIMIT ด้านล่าง
const MOBILE_TAB_CANDIDATES = [
  { id: 'Executive', label: 'หน้าหลัก', renderIcon: Icons.Executive, group: ['Executive', 'Monthly'] },
  { id: 'Inventory', label: 'สต็อก', renderIcon: Icons.Inventory },
  { id: 'Claims', label: 'เคลม', renderIcon: Icons.Claims },
  { id: 'Planner Control', label: 'แพลน', renderIcon: Icons.PlannerControl, group: ['Planner Control', 'FeedProducts'] },
]
// ป้ายสั้นสำหรับ role แคบที่โชว์ทุกแท็บตรงๆ บน bottom bar (label เต็มใน menuGroups ยาวเกินจะพอดีปุ่มเล็ก)
const MOBILE_SHORT_LABELS = { Inventory: 'สต็อก', 'Stock Movement': 'เข้า-ออก', Executive: 'หน้าหลัก', Claims: 'เคลม' }
// จำนวนแท็บสูงสุดที่ยัดลง bottom bar ได้พอดีโดยไม่ต้องมีปุ่ม "เมนู" เพิ่ม (นิ้วโป้งกดถนัด)
const MOBILE_TAB_LIMIT = 5

// แท็บย่อยของ Dashboard ใหญ่ที่ยุบมาจากหลายหน้า (render เดิมของแต่ละหน้ายังอยู่ครบ)
const SALES_SUBTABS = [['Executive', 'ภาพรวม'], ['Monthly', 'รายเดือน']]
const PRODUCT_SUBTABS = [['Products', 'ภาพรวมสินค้า'], ['ProductTrends', '% เปลี่ยนแปลง']]
const PLANNER_SUBTABS = [['Planner Control', 'แพลนฟีด'], ['FeedProducts', 'สินค้าที่ต้องฟีด']]
const SUB_TABS = {
  Executive: SALES_SUBTABS, Monthly: SALES_SUBTABS,
  Products: PRODUCT_SUBTABS, ProductTrends: PRODUCT_SUBTABS,
  'Planner Control': PLANNER_SUBTABS, FeedProducts: PLANNER_SUBTABS,
}

function AlertsSection({ alerts }) {
  if (!alerts || alerts.length === 0) return null;
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--payi-text)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--payi-danger)', display: 'inline-block' }}></span>
        Alert Center · ความผิดปกติที่ต้องจัดการด่วน
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {alerts.map((alert, idx) => {
          const isCritical = alert.type === 'critical';
          const bg = isCritical ? 'var(--payi-danger-bg)' : 'var(--payi-surface)beb';
          const border = isCritical ? 'var(--payi-danger)' : 'var(--payi-warning)';
          const textColor = isCritical ? 'var(--payi-danger)' : 'var(--payi-warning)';
          const badgeBg = isCritical ? 'var(--payi-danger-bg)' : 'var(--payi-warning-bg)';
          const Icon = isCritical ? AlertCircle : AlertTriangle;

          return (
            <div key={idx} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 14, padding: '16px 20px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, boxShadow: '0 4px 12px rgba(15,23,42,0.01)' }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{ marginTop: 2, color: isCritical ? 'var(--payi-danger)' : 'var(--payi-warning)' }}>
                  <Icon size={20} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: badgeBg, color: textColor, letterSpacing: '0.03em' }}>{alert.category || alert.code || 'ALERT'}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--payi-text-strong)', marginTop: 6 }}>{alert.message}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TrendingCard({ title, items, isUp }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 16, padding: '20px', flex: '1 1 260px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        {isUp ? <TrendingUp size={18} color="var(--payi-success)" /> : <TrendingDown size={18} color="var(--payi-danger)" />}
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--payi-text-strong)' }}>{title}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map((item, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: idx < items.length - 1 ? 12 : 0, borderBottom: idx < items.length - 1 ? '1px solid var(--payi-border)' : 'none' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--payi-text-strong)' }}>{item.display_name}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: isUp ? 'var(--payi-success)' : 'var(--payi-danger)' }}>
                {isUp ? '+' : ''}{item.delta?.toLocaleString()}
              </div>
              <div style={{ fontSize: 10, color: 'var(--payi-text-faint)' }}>
                เดือนนี้: ฿{(item.monthRevenue || 0).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const ROI_THAI_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const roiMonthLabel = (ym) => `${ROI_THAI_MONTH[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`

// ROI (ROAS) เทียบ Ads spend (marketing_inputs, กรอกมือ) กับยอดขายจริง (raw_orders) —
// เดินตาม filter เดียวกับตัวกรองเดือนบน Executive (filterMonth = '' คือ "ทั้งหมด" รวมทุกเดือนที่มีค่า Ads,
// filterMonth = 'YYYY-MM' คือเจาะจงเดือนนั้นตามที่ผู้ใช้เลือกบน dropdown) — คืน null ถ้ายังไม่มีใครกรอกค่า
// Ads เลย หรือเดือนที่เลือกยังไม่มีค่า Ads (กันการ์ดโชว์เลขเปล่า)
function useRoiStats(filterMonth) {
  const [state, setState] = useState({ loading: true, months: [] })
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/marketing?kind=inputs').then((r) => r.json()),
      fetch('/api/monthly').then((r) => r.json()),
    ]).then(([mi, mo]) => {
      if (cancelled) return
      if (!mi.success || !mo.success) throw new Error(mi.error || mo.error || 'โหลดไม่สำเร็จ')
      const adsByMonth = {}
      for (const r of mi.inputs || []) {
        if (r.metric !== 'ads') continue
        adsByMonth[r.month] = (adsByMonth[r.month] || 0) + r.value
      }
      const salesByMonth = {}
      for (const t of mo.trend || []) salesByMonth[t.month] = t.sales
      const months = Object.keys(adsByMonth).filter((m) => adsByMonth[m] > 0).sort()
      setState({ loading: false, months, adsByMonth, salesByMonth })
    }).catch(() => { if (!cancelled) setState({ loading: false, months: [] }) })
    return () => { cancelled = true }
  }, [])

  if (state.loading || state.months.length === 0) return null
  const { months, adsByMonth, salesByMonth } = state
  const totalAds = months.reduce((s, m) => s + adsByMonth[m], 0)
  const totalSales = months.reduce((s, m) => s + (salesByMonth[m] || 0), 0)
  const roiOverall = totalAds > 0 ? totalSales / totalAds : null

  if (filterMonth) {
    // เจาะจงเดือน — ยังไม่มีค่า Ads กรอกไว้เดือนนี้ก็ไม่โชว์การ์ด (กันตัวเลข 0/ว่างที่เข้าใจผิดว่าเป็นค่าจริง)
    const ads = adsByMonth[filterMonth]
    if (!ads) return null
    const sales = salesByMonth[filterMonth] || 0
    return { label: roiMonthLabel(filterMonth), ads, roi: sales / ads, totalAds, roiOverall }
  }
  return { label: 'ทั้งหมด', ads: totalAds, roi: roiOverall, totalAds, roiOverall }
}

// ============================================================
// SIDE DRAWER PRODUCT INSIGHT (REAL CONNECTED)
// ============================================================
function ProductInsightDrawer({ isOpen, onClose, selectedSku }) {
  if (!isOpen || !selectedSku) return null;

  const platformEntries = Object.entries(selectedSku.platforms || {})
    .map(([name, revenue]) => ({
      name,
      revenue: Number(revenue),
      qty: Number((selectedSku.platformUnits || {})[name] || 0),
      fill: PLATFORM_COLORS[name] || '#888'
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const skuRealChartData = platformEntries.length > 0
    ? platformEntries
    : [
        { name: 'Shopee',     revenue: 0, qty: 0, fill: PLATFORM_COLORS['Shopee'] },
        { name: 'TikTok Shop', revenue: 0, qty: 0, fill: PLATFORM_COLORS['TikTok Shop'] },
        { name: 'Lazada',     revenue: 0, qty: 0, fill: PLATFORM_COLORS['Lazada'] },
      ];

  const totalPlatformRev = skuRealChartData.reduce((s, p) => s + p.revenue, 0);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.15)', backdropFilter: 'blur(4px)',
          zIndex: 998
        }}
      />

      <div className="payi-drawer-slide-in app-side-drawer" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: '460px', maxWidth: '100vw', backgroundColor: 'var(--payi-surface)',
        boxShadow: '-10px 0 40px rgba(15, 23, 42, 0.08)',
        zIndex: 999, display: 'flex', flexDirection: 'column',
        padding: '32px', boxSizing: 'border-box', overflowY: 'auto'
      }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div style={{ maxWidth: '85%' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', backgroundColor: 'var(--payi-mint-soft)', color: 'var(--payi-mint)', borderRadius: 6 }}>
              {selectedSku.skuCount} SKU ในกลุ่ม
            </span>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--payi-text-strong)', marginTop: 8, lineHeight: 1.4 }}>
              {selectedSku.display_name}
            </h3>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--payi-border)', padding: 6, borderRadius: '50%', cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--payi-text-muted)' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20, paddingRight: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ background: 'var(--payi-surface-muted)', border: '1px solid var(--payi-border)', padding: '16px', borderRadius: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', fontWeight: 500 }}>ยอดขายรวม SKU นี้</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--payi-text-strong)', marginTop: 6 }}>฿{fmt(selectedSku.revenue)}</div>
            </div>
            <div style={{ background: 'var(--payi-surface-muted)', border: '1px solid var(--payi-border)', padding: '16px', borderRadius: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--payi-text-muted)', fontWeight: 500 }}>จำนวนชิ้นที่ขายได้</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--payi-text-strong)', marginTop: 6 }}>{fmt(selectedSku.qty)} ชิ้น</div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--payi-text)', marginBottom: 14 }}>สัดส่วนรายรับตามช่องทางจริง (Real Revenue Breakdown)</div>
            <div style={{ width: '100%', height: 140, background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 16, padding: '14px 14px 0 0', boxSizing: 'border-box' }}>
              {totalPlatformRev > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={skuRealChartData} layout="vertical" margin={{ top: 5, right: 10, left: 15, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--payi-text-muted)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `฿${fmt(v)}`} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: 'var(--payi-text)', fontWeight: 500 }} axisLine={false} tickLine={false} width={75} />
                    <Tooltip cursor={{ fill: 'rgba(0,0,0,0.02)' }} contentStyle={{ borderRadius: 8, border: '1px solid var(--payi-border)', fontSize: 12 }} formatter={(v) => [`฿${fmt(v)}`, 'ยอดขาย']} />
                    <Bar dataKey="revenue" radius={[0, 8, 8, 0]} barSize={12}>
                      {skuRealChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ height: '100%', display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--payi-text-faint)' }}>ไม่มีข้อมูลแยกสัดส่วนช่องทางขาย</div>
              )}
            </div>
          </div>

          {totalPlatformRev > 0 && (
            <div style={{ background: 'var(--payi-surface-muted)', border: '1px solid var(--payi-border)', borderRadius: 16, padding: '14px 16px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--payi-text)', marginBottom: 10 }}>รายละเอียดแยกช่องทาง</div>
              {skuRealChartData.map((p, i) => {
                const pct = totalPlatformRev > 0 ? Math.round(p.revenue / totalPlatformRev * 100) : 0;
                return (
                  <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < skuRealChartData.length - 1 ? '1px solid var(--payi-border)' : 'none' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: p.fill, flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--payi-text-strong)' }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--payi-text-faint)', width: 64, textAlign: 'right' }}>{fmt(p.qty)} ชิ้น</div>
                    <div style={{ fontSize: 11, color: 'var(--payi-text-faint)', width: 32, textAlign: 'right' }}>{pct}%</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--payi-text-strong)', width: 90, textAlign: 'right' }}>฿{fmt(p.revenue)}</div>
                  </div>
                );
              })}
            </div>
          )}

          {selectedSku.skus?.length > 0 && (
            <div style={{ background: 'var(--payi-surface-muted)', border: '1px solid var(--payi-border)', borderRadius: 16, padding: '14px 16px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--payi-text)', marginBottom: 8 }}>SKU ในกลุ่มนี้ ({selectedSku.skus.length}) — ไว้ใช้จัดการสต็อก</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {selectedSku.skus.map((sk) => (
                  <span key={sk} style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', color: 'var(--payi-text)' }}>{sk}</span>
                ))}
              </div>
            </div>
          )}

          <div style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)', border: '1px solid #bbf7d0', borderRadius: 20, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#15803d', fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
              <Sparkles size={16} />
              คำแนะนำกลยุทธ์จาก PAYI Brain
            </div>
            <p style={{ fontSize: 13, color: '#166534', lineHeight: 1.6, margin: 0 }}>
              จากการตรวจสอบข้อมูลระบบคลังและคำสั่งซื้อจริง สินค้าชิ้นนี้ทำผลงานได้เสถียรมาก แนะนำให้จัดแคมเปญกระตุ้นเพิ่มในช่องทางที่ทำรายได้หลัก พร้อมกับนำจุดขาย (Pain Point) ที่ลูกค้าชอบรีวิวไปดันบรีฟงานตัวใหม่ให้ทีมครีเอเตอร์ทำวิดีโอสั้นลง TikTok และ Facebook ทันทีเพื่อรับกระแสแอดครับบอส!
            </p>
          </div>

        </div>
      </div>
    </>
  );
}

export default function App() {
  const currentRole = (() => {
    try { return normalizeRole(JSON.parse(localStorage.getItem('payi-user') || 'null')?.role || 'dev') } catch { return 'dev' }
  })()
  const visibleMenuGroups = menuGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => canAccessTab(currentRole, item.id)) }))
    .filter((group) => group.items.length > 0)
  // แถบล่างมือถือ — role ที่เห็นแท็บเยอะ (boss/dev/staff) ใช้ 4 อันที่ใช้บ่อยสุด ที่เหลือกดปุ่ม "เมนู"
  // role แคบที่เห็นแท็บน้อย (เช่น stock — เห็นแค่ Inventory/Stock Movement) ยัดทุกแท็บที่ตัวเองเห็นลง
  // bottom bar ตรงๆ เลย ไม่ต้องมีปุ่ม "เมนู" ซ้อนอีกชั้นเพราะมีของให้กดแค่ไม่กี่อย่างอยู่แล้ว
  const allVisibleTabs = visibleMenuGroups.flatMap((group) => group.items)
  const showAllTabsDirect = allVisibleTabs.length > 0 && allVisibleTabs.length <= MOBILE_TAB_LIMIT
  const mobileTabItems = showAllTabsDirect
    ? allVisibleTabs.map((item) => ({ ...item, label: MOBILE_SHORT_LABELS[item.id] || item.label }))
    : MOBILE_TAB_CANDIDATES.filter((item) => canAccessTab(currentRole, item.id))
  const firstAllowedTab = currentRole === 'stock' ? STOCK_TABS[0] : currentRole === 'staff' ? STAFF_TABS[0] : 'Executive'
  // หน้าแรก = หน้าว่างเสมอทุกครั้งที่เข้าเว็บ (ไม่จำแท็บล่าสุด) กันหน้า Dashboard หนักโหลดช้าทุกครั้ง
  const [activeTab, setActiveTab] = useState('Home')
  const [visitedTabs, setVisitedTabs] = useState(() => new Set())

  useEffect(() => {
    setVisitedTabs((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)))
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'Home') return
    if (!canAccessTab(currentRole, activeTab)) setActiveTab(firstAllowedTab)
  }, [activeTab, currentRole, firstAllowedTab])

  useEffect(() => {
    try {
      localStorage.setItem('payi-active-tab', activeTab)
    } catch {}
  }, [activeTab])

  // sidebar ล็อคขยายไว้ตลอด (เดิมย่อเหลือแค่ไอคอน เอาเมาส์ชี้ถึงขยาย — owner ขอให้ล็อคไว้ ไม่ต้องเก็บแล้ว)
  const sidebarExpanded = true
  // มือถือ (<=860px, ดูใน theme.css): sidebar ทั้งแถบซ่อนไปเลย ใช้ bottom tab bar + more sheet แทน
  // (ของเดิมเป็นลิ้นชักเลื่อนออกจาก sidebar — owner ขอเปลี่ยนเป็นแท็บล่างสไตล์แอพธนาคาร)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [marketingDueCount, setMarketingDueCount] = useState(() => {
    try { return Number(localStorage.getItem('payi-marketing-due-count') || 0) } catch { return 0 }
  })
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth <= 860)
  useEffect(() => {
    const onResize = () => setIsMobileViewport(window.innerWidth <= 860)
    const onMarketingDue = (event) => setMarketingDueCount(Number(event.detail || 0))
    window.addEventListener('resize', onResize)
    window.addEventListener('payi-marketing-due', onMarketingDue)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('payi-marketing-due', onMarketingDue)
    }
  }, [])

  // DATE FILTER STATES
  const [datePreset, setDatePreset] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [business, setBusiness] = useState('all')
  const [platform, setPlatform] = useState('all')
  const [chartMode, setChartMode] = useState('revenue')
  const [period, setPeriod] = useState('daily')
  const [searchQuery, setSearchQuery] = useState('')
  const [showSkuModal, setShowSkuModal] = useState(false)

  // DRAWER STATE
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedSkuData, setSelectedSkuData] = useState(null);

  const [dashData, setDashData] = useState(null)
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState(null)

  const handleNavigate = (destination) => {
    if (destination === 'unmapped') {
      setActiveTab('Unmapped')
    } else if (destination === 'reports') {
      setActiveTab('Executive')
    }
  }

  const handlePresetChange = (preset) => {
    setDatePreset(preset)
    setBusiness('all')
    setPlatform('all')
    const fmtISO = (d) => d.toISOString().slice(0, 10)
    const anchorDate = dashData?.dataRange?.latestDate
      ? new Date(`${dashData.dataRange.latestDate}T00:00:00`)
      : new Date()
    
    if (preset === 'today') {
      const tStr = fmtISO(anchorDate)
      setStartDate(tStr); setEndDate(tStr)
    } else if (preset === '7d') {
      const s = new Date(anchorDate); s.setDate(anchorDate.getDate() - 6)
      setStartDate(fmtISO(s)); setEndDate(fmtISO(anchorDate))
    } else if (preset === '30d') {
      const s = new Date(anchorDate); s.setDate(anchorDate.getDate() - 29)
      setStartDate(fmtISO(s)); setEndDate(fmtISO(anchorDate))
    } else if (preset === 'all') {
      setStartDate(''); setEndDate('')
    }
  }

  // เลือกช่วงวันที่แบบ dropdown เดือน แทนพิมพ์วันที่ 2 ช่องแยกกัน — ของเดิมแต่ละช่องยิง fetch
  // ของตัวเอง เลือกวันที่ทีละช่องเลยโหลดซ้ำ 2 รอบต่อการเลือก 1 ช่วง ไหนจะ native date picker บาง
  // เบราว์เซอร์ยิง onChange หลายครั้งระหว่างคลิกปฏิทินอีก — dropdown เดือนยิง fetch แค่ครั้งเดียวจบ
  const monthOptions = useMemo(() => {
    const early = dashData?.dataRange?.earliestDate, late = dashData?.dataRange?.latestDate
    if (!early || !late) return []
    const months = []
    let y = Number(early.slice(0, 4)), m = Number(early.slice(5, 7))
    const ey = Number(late.slice(0, 4)), em = Number(late.slice(5, 7))
    while (y < ey || (y === ey && m <= em)) {
      months.push(`${y}-${String(m).padStart(2, '0')}`)
      m++; if (m > 12) { m = 1; y++ }
    }
    return months.reverse()
  }, [dashData?.dataRange?.earliestDate, dashData?.dataRange?.latestDate])

  const THAI_MONTH_LABEL = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
  const monthLabel = (ym) => `${THAI_MONTH_LABEL[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
  const selectedMonth = (startDate && endDate && startDate.slice(0, 7) === endDate.slice(0, 7) && startDate.endsWith('-01')) ? startDate.slice(0, 7) : ''
  const handleMonthChange = (ym) => {
    setBusiness('all'); setPlatform('all')
    if (!ym) { setStartDate(''); setEndDate(''); setDatePreset('all'); return }
    const [y, m] = ym.split('-').map(Number)
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
    setStartDate(`${ym}-01`); setEndDate(`${ym}-${String(lastDay).padStart(2, '0')}`); setDatePreset('custom')
  }

  const fetchDashboard = useCallback(async () => {
    setIsFetching(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (business !== 'all') params.set('business', business)
      if (platform !== 'all') params.set('platform', platform)
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      const url = `${API_BASE}/dashboard${params.toString() ? '?' + params.toString() : ''}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'API error')
      setDashData(data)
    } catch (err) {
      console.error('[dashboard] fetch error:', err)
      setError(err.message)
    } finally {
      setIsFetching(false)
    }
  }, [business, platform, startDate, endDate])

  const dashFetchSig = useRef(null)
  useEffect(() => {
    if (activeTab === 'Executive' || activeTab === 'FeedProducts') {
      const sig = JSON.stringify({ business, platform, startDate, endDate })
      if (dashFetchSig.current === sig) return // แค่สลับแท็บกลับมา ข้อมูลเดิมยังใช้ได้ ไม่ต้องโหลดซ้ำ
      dashFetchSig.current = sig
      fetchDashboard()
    }
  }, [activeTab, business, platform, startDate, endDate, fetchDashboard])

  // ─── Get data from commandCenter ──────────────────────────────────────
  const commandCenter = dashData?.commandCenter || {}
  const alerts = commandCenter.alerts || []
  const trendingUp = commandCenter.trendingUp || []
  const trendingDown = commandCenter.trendingDown || []
  const trendCompare = commandCenter.trendCompare || null
  const roiStats = useRoiStats(selectedMonth)

  // ─── Original KPI data ────────────────────────────────────────────────
  const totalRevenue = dashData?.revenue ?? 0
  const totalGrossRevenue = dashData?.grossRevenue ?? 0
  const totalOrders  = dashData?.orders ?? 0
  const totalQty     = dashData?.units ?? 0
  const avgOrder     = dashData?.aov ?? 0

  // ─── KPI Trends จาก server ────────────────────────────────────────────
  const revenueTrend = dashData?.revenueTrend ?? null
  const ordersTrend  = dashData?.ordersTrend  ?? null
  const unitsTrend   = dashData?.unitsTrend   ?? null
  const aovTrend     = dashData?.aovTrend     ?? null

  const chartData = useMemo(() => {
    if (!dashData) return []
    const sourceByDay = chartMode === 'orders'
      ? (dashData.ordersByDay || []).map(d => ({ date: d.date, value: d.count }))
      : (dashData.revenueByDay || []).map(d => ({ date: d.date, value: d.amount }))

    if (period === 'daily') {
      return sourceByDay.map(d => ({ label: d.date, [chartMode === 'orders' ? 'orders' : 'revenue']: d.value }))
    }

    const buckets = {}
    for (const d of sourceByDay) {
      let key
      if (period === 'weekly') {
        const dt = new Date(d.date)
        const day = dt.getDay() || 7
        dt.setDate(dt.getDate() + 4 - day)
        const yearStart = new Date(dt.getFullYear(), 0, 1)
        const week = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7)
        key = `${dt.getFullYear()}-W${String(week).padStart(2, '0')}`
      } else if (period === 'monthly') {
        key = d.date.slice(0, 7)
      } else {
        key = d.date.slice(0, 4)
      }
      buckets[key] = (buckets[key] || 0) + d.value
    }
    const dataKey = chartMode === 'orders' ? 'orders' : 'revenue'
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, v]) => ({ label, [dataKey]: v }))
  }, [dashData, period, chartMode])

  const businesses = useMemo(() => {
    if (!dashData?.businessBreakdown) return []
    return dashData.businessBreakdown.map(b => b.name).sort()
  }, [dashData])

  const platforms = useMemo(() => {
    if (!dashData?.platformBreakdown) return []
    return dashData.platformBreakdown.map(p => p.name).sort()
  }, [dashData])

  const byPlatform = useMemo(() => {
    return (dashData?.platformBreakdown || []).map(p => ({ name: p.name, revenue: p.amount }))
  }, [dashData])

  // รวมเป็นรายสินค้า (product family) ไม่ใช่รายแยก SKU/ไซส์ — SKU จริงยังอยู่ใน skus (ไว้ใช้จัดการสต็อกทีหลัง)
  const topSkus = useMemo(() => {
    const raw = dashData?.topSkus || []
    return raw.map(s => ({
      key: s.key ?? s.sku ?? s.master_sku ?? '',
      display_name: s.display_name ?? s.product_name ?? s.name ?? '',
      skuCount: Number(s.skuCount ?? (Array.isArray(s.skus) ? s.skus.length : 1) ?? 1),
      skus: s.skus ?? [],
      orders: Number(s.orders ?? s.count ?? 0),
      qty: Number(s.qty ?? s.quantity ?? s.units ?? 0),
      revenue: Number(s.amount ?? s.revenue ?? 0),
      platforms: s.platforms || {},
      platformUnits: s.platformUnits || {}
    })).sort((a, b) => b.revenue - a.revenue).slice(0, 20)
  }, [dashData])

  const filteredSkus = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return topSkus
    return topSkus.filter(s =>
      s.display_name.toLowerCase().includes(q) || s.skus.some(sk => sk.toLowerCase().includes(q))
    )
  }, [topSkus, searchQuery])

  const visibleSkus = useMemo(() => {
  return filteredSkus.slice(0, 10)
  }, [filteredSkus])

  const activeChart = chartMode === 'orders' 
    ? { title: 'Orders Trend', label: 'Orders', dataKey: 'orders', formatter: (value) => [fmt(value), 'Orders'], gradientFrom: '#7c3aed' }
    : { title: 'Revenue Trend', label: 'Revenue', dataKey: 'revenue', formatter: (value) => [`฿${fmt(value)}`, 'Revenue'], gradientFrom: 'var(--payi-mint)' };

  const pageMeta = {
    Executive: {
      title: 'Dashboard สรุปยอดขาย',
      eyebrow: 'Overview',
      subtitle: 'ภาพรวมคำสั่งซื้อรายวัน + สรุปรายเดือน (ยอดขาย ออเดอร์ ร้าน แพลตฟอร์ม)'
    },
    Monthly: {
      title: 'Dashboard สรุปยอดขาย',
      eyebrow: 'Overview',
      subtitle: 'ภาพรวมคำสั่งซื้อรายวัน + สรุปรายเดือน (ยอดขาย ออเดอร์ ร้าน แพลตฟอร์ม)'
    },
    'Import Orders': {
      title: 'Import Orders',
      eyebrow: 'Sales',
      subtitle: 'Upload marketplace orders and prepare them for reconciliation.'
    },
    Products: {
      title: 'Dashboard สินค้า',
      eyebrow: 'Overview',
      subtitle: 'ผลงานสินค้ารายกลุ่ม (รวมไซส์/รุ่นย่อยเป็นตัวเดียว) · สินค้าขายดี แนวโน้ม และ SKU ในกลุ่ม'
    },
    ProductTrends: {
      title: 'Dashboard สินค้า',
      eyebrow: 'Overview',
      subtitle: 'ผลงานสินค้ารายกลุ่ม + % เปลี่ยนแปลงรายเดือน (จำนวนชิ้น & ยอดขาย)'
    },
    AdsChannels: {
      title: 'Ads & Channels',
      eyebrow: 'Marketing',
      subtitle: 'ค่า Ads และ TikTok channel (Affiliate/Live/VDO) รายเดือน · กรอกมือ + กราฟเทียบกับ Orders'
    },
    MarketingRadar: {
      title: 'เรดาร์การตลาด',
      eyebrow: 'Marketing',
      subtitle: 'บันทึกสิ่งที่เปลี่ยน วัดจำนวนชิ้นหลัง 7/30 วัน และส่งงานให้ Boss ตัดสินใจ'
    },
    'Planner Control': {
      title: 'Planner Control',
      eyebrow: 'Operations Planning',
      subtitle: 'วางแผนผลิตจาก Stock, ยอดออก, Manpower & OT และความเสี่ยงจาก Claims'
    },
    FeedProducts: {
      title: 'สินค้าที่ต้องฟีด',
      eyebrow: 'Operations Planning',
      subtitle: 'จำนวนสินค้าราย SKU สำหรับใช้ประกอบการวางแผนฟีด'
    },
    HR: {
      title: 'พนักงาน (ลา)',
      eyebrow: 'Operations Planning',
      subtitle: 'คำขอลา + อนุมัติ และวันลาพักร้อนคงเหลือ'
    },
    Inventory: {
      title: 'Inventory',
      eyebrow: 'Operations Planning',
      subtitle: 'ภาพรวมสต็อกสินค้า — คงเหลือคำนวณสดจากรายการเข้า-ออกทั้งหมด'
    },
    'Stock Movement': {
      title: 'Stock Movement',
      eyebrow: 'Operations Planning',
      subtitle: 'ประวัติรายการรับเข้า-เบิกออกสต็อกทั้งหมด'
    },
    Claims: {
      title: 'Claim View',
      eyebrow: 'Operations Planning',
      subtitle: 'วิเคราะห์สถิติจดแจ้งยอดเคลมสินค้า'
    },
    ContentOS: {
      title: 'Content OS Prototype',
      eyebrow: 'Marketing',
      subtitle: 'Content Intelligence Prototype'
    }
  }[activeTab] || {
    title: activeTab,
    eyebrow: menuGroups.find(group => group.items.some(item => item.id === activeTab))?.title || 'Workspace',
    subtitle: 'Payi Ops workspace'
  }

  const rangeLabel = datePreset === 'today'
    ? 'Today'
    : datePreset === '7d'
      ? 'Last 7 days'
      : datePreset === '30d'
        ? 'Last 30 days'
        : startDate || endDate
          ? `${startDate || 'Start'} to ${endDate || 'End'}`
          : 'All time'

  const fmtTrend = (v) => {
    if (v === null || v === undefined) return null
    return `${v >= 0 ? '+' : ''}${v}%`
  }

  const isLinksHubMode = activeTab === 'Links Hub'
  const hidePageTitleCard = activeTab === 'MarketingRadar'
  const isSwanPastelPage = activeTab === 'Inventory' || activeTab === 'Stock Movement'

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f7fbff', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif', color: 'var(--payi-text-strong)' }}>
      
      {/* SIDEBAR NAVIGATION — desktop เท่านั้น (ล็อคขยายไว้ตลอด) มือถือใช้ bottom tab bar แทนทั้งหมด
          เช็ค isMobileViewport ใน JS ตรงๆ ไม่พึ่ง CSS display:none ล้วนๆ — เจอ !important ไม่ยอม
          ทับ inline บางจังหวะในสภาพแวดล้อมทดสอบนี้มาแล้วรอบนึง (ดู commit ก่อนหน้าเรื่อง sidebar
          z-index/backdrop บังเมนู) เลี่ยงบั๊กคลาสเดียวกันซ้ำโดยไม่ render เลยแทน */}
      {!isMobileViewport && (
      <div
        className="payi-sidebar-nav"
        style={{
          width: sidebarExpanded ? 240 : 68, height: '100vh', top: 0, background: '#ffffff', borderRight: '1px solid #e2e8f0',
          display: 'flex', flexDirection: 'column', padding: '12px 11px 10px', boxSizing: 'border-box', flexShrink: 0,
          boxShadow: sidebarExpanded ? '18px 0 48px rgba(15, 23, 42, 0.08)' : '18px 0 48px rgba(15, 23, 42, 0.04)',
          overflow: 'hidden', position: 'sticky', zIndex: 20, transition: 'width 180ms ease, box-shadow 180ms ease',
        }}
      >
        <div style={{ marginBottom: 10, paddingLeft: 3, display: 'flex', alignItems: 'center', gap: 9 }}>
          <img src={payiLogo} alt="Payi Ops" style={{ width: 39, height: 39, borderRadius: 9, objectFit: 'cover', boxShadow: '0 9px 22px rgba(37, 99, 235, 0.14)', flexShrink: 0 }} />
          {sidebarExpanded && (
            <div style={{ whiteSpace: 'nowrap' }}>
              <div style={{ fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>Payi Ops</div>
              <div style={{ fontSize: '9.5px', fontWeight: '700', color: '#334155', letterSpacing: 0, marginTop: '2px' }}>Business Command Center</div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', paddingRight: 0 }}>
          {visibleMenuGroups.map((group, gi) => (
            <div
              key={group.title}
              style={{
                display: 'flex', flexDirection: 'column', gap: 1, flex: '0 0 auto',
                // เส้นคั่นบางๆ ระหว่างหมวด — ตอนย่อไม่มี label กลุ่มให้ดู ต้องมีเส้นคั่นแทนกันมองเป็นเมนูก้อนเดียว
                borderTop: gi > 0 ? '1px solid #eef2f7' : 'none', paddingTop: gi > 0 ? 6 : 0, marginTop: gi > 0 ? 5 : 0,
              }}
            >
              {sidebarExpanded && <div style={{ padding: '2px 9px 3px', color: '#94a3b8', fontSize: 9, lineHeight: 1, fontWeight: 900, letterSpacing: '.08em', whiteSpace: 'nowrap' }}>{group.title}</div>}
              {group.items.map((item) => {
                const isActive = item.group ? item.group.includes(activeTab) : activeTab === item.id
                return (
                  <button
                    key={item.id}
                    data-nav-id={item.id}
                    title={sidebarExpanded ? undefined : item.label}
                    onClick={() => setActiveTab(item.id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: sidebarExpanded ? 'space-between' : 'center', flex: '1 1 0', width: '100%', padding: sidebarExpanded ? '7px 9px' : '7px 0', minHeight: 32, border: 'none', borderRadius: 10,
                      background: isActive
                          ? item.id === 'MarketingRadar'
                          ? 'linear-gradient(135deg, #467fa8 0%, #4299aa 54%, #4ba99f 100%)'
                          : item.id === 'Inventory' || item.id === 'Stock Movement'
                          ? 'linear-gradient(135deg, #7198d5 0%, #a782da 52%, #dc87b7 100%)'
                          : 'linear-gradient(135deg, var(--payi-mint) 0%, #34d399 100%)'
                        : 'transparent',
                      boxShadow: isActive ? '0 6px 16px rgba(55,95,110,0.18)' : 'none',
                      color: isActive ? '#fff' : '#0f172a', cursor: 'pointer', fontSize: '13.5px', lineHeight: 1.1, fontWeight: isActive ? '850' : '700', textAlign: 'left', transition: 'background 140ms ease, color 140ms ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ color: isActive ? '#fff' : '#334155', display: 'flex', alignItems: 'center', flexShrink: 0 }}><item.renderIcon size={16} /></span>
                      {sidebarExpanded && (
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                          {item.helper && (
                            <span style={{ fontSize: 8.5, lineHeight: 1, color: isActive ? 'rgba(255,255,255,0.82)' : '#64748b', whiteSpace: 'nowrap' }}>{item.helper}</span>
                          )}
                        </span>
                      )}
                    </div>
                    {sidebarExpanded && item.id === 'MarketingRadar' && marketingDueCount > 0 ? (
                      <span
                        aria-label={`${marketingDueCount} งานรอตัดสินใจ`}
                        style={{
                          minWidth: 20,
                          height: 20,
                          padding: '0 6px',
                          borderRadius: 999,
                          display: 'grid',
                          placeItems: 'center',
                          background: isActive ? 'rgba(255,255,255,0.22)' : 'var(--payi-mint-soft)',
                          color: isActive ? '#fff' : 'var(--payi-mint-strong)',
                          fontSize: 10,
                          fontWeight: 900,
                          fontVariantNumeric: 'tabular-nums',
                          flexShrink: 0,
                        }}
                      >
                        {marketingDueCount > 99 ? '99+' : marketingDueCount}
                      </span>
                    ) : sidebarExpanded && item.dotColor && !isActive ? (
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: item.dotColor, marginRight: '6px', flexShrink: 0 }} />
                    ) : null}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      )}

      {/* MAIN CONTENT AREA */}
      <div className="payi-main-content" style={{ flex: 1, minHeight: '100vh', overflow: 'auto', padding: isLinksHubMode ? '32px 34px 40px' : '24px 32px 40px', boxSizing: 'border-box', width: '100%' }}>

        {/* HEADER TOP ROW — เดิมเป็นกล่องไล่สีมนๆ เหมือน hero การ์ดยอดขายด้านล่าง (Executive) ทำให้ดูซ้ำ
            หลุดโฟกัส (feedback เจ้าของ 2026-07-29) — เปลี่ยนเป็น header เรียบๆ แค่ตัวหนังสือ ให้ gradient
            เหลือแค่การ์ดตัวเลขสำคัญจริงๆ (เช่น Total Revenue) เด่นแทน */}
        {!isLinksHubMode && <div className="payi-topbar" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: hidePageTitleCard ? 'flex-end' : 'space-between', gap: 18, marginBottom: hidePageTitleCard ? 12 : 18, alignItems: 'center' }}>
          {!hidePageTitleCard && <div style={{ width: isMobileViewport ? '100%' : 'auto' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: isSwanPastelPage ? '#a782da' : 'var(--payi-mint-strong)', marginBottom: 4 }}>{pageMeta.eyebrow}</div>
            <div style={{ fontSize: 24, fontWeight: 850, letterSpacing: 0, color: 'var(--payi-text-strong)', marginBottom: 2 }}>{pageMeta.title}</div>
            <div style={{ fontSize: 13, color: 'var(--payi-text-muted)' }}>{pageMeta.subtitle}</div>
          </div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="payi-topbar-search" style={{ display: 'flex', alignItems: 'center', gap: 10, width: 280, background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(14px)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: 999, padding: '10px 14px', boxShadow: '0 8px 20px rgba(16,24,40,0.06)' }}>
              <Search size={16} color="var(--payi-text-muted)" />
              <input
                placeholder="ค้นหา SKU หรือแคมเปญ"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 13, color: 'var(--payi-surface-dark)', background: 'transparent' }}
              />
            </div>
            <button title="Notifications" style={{ width: 40, height: 40, borderRadius: 999, background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(14px)', border: '1px solid rgba(255,255,255,0.6)', display: 'grid', placeItems: 'center', boxShadow: '0 8px 20px rgba(16,24,40,0.06)' }}><Bell size={18} color="var(--payi-mint-strong)" /></button>
            <button
              title="ออกจากระบบ"
              onClick={() => {
                if (!localStorage.getItem('payi-api-token')) return // โหมด dev ไม่มี login
                if (window.confirm('ออกจากระบบ?')) {
                  localStorage.removeItem('payi-api-token')
                  localStorage.removeItem('payi-user')
                  window.location.reload()
                }
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, border: '1px solid rgba(255,255,255,0.6)', borderRadius: 999, padding: '9px 14px 9px 9px', background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(14px)', boxShadow: '0 8px 20px rgba(16,24,40,0.06)', color: 'var(--payi-surface-dark)', cursor: 'pointer' }}>
              <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--payi-gradient-primary)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <UserCircle2 size={16} color="#fff" />
              </span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>
                {(() => { try { return JSON.parse(localStorage.getItem('payi-user') || 'null')?.name || 'Nook' } catch { return 'Nook' } })()}
              </span>
            </button>
          </div>
        </div>}

        {/* SUB-TABS ของ Dashboard ใหญ่ (สรุปยอดขาย / สินค้า) */}
        {SUB_TABS[activeTab] && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--payi-border)' }}>
            {SUB_TABS[activeTab].map(([id, label]) => {
              const on = activeTab === id
              return (
                <button key={id} onClick={() => setActiveTab(id)} style={{
                  padding: '9px 18px', fontSize: 13, fontWeight: on ? 800 : 600, border: 'none', cursor: 'pointer',
                  background: 'transparent', color: on ? 'var(--payi-mint-strong)' : 'var(--payi-text-muted)',
                  borderBottom: on ? '2px solid var(--payi-mint)' : '2px solid transparent', marginBottom: -1,
                }}>{label}</button>
              )
            })}
          </div>
        )}

        <Suspense fallback={<ModuleFallback />}>
        {(activeTab === 'Home') ? (
          <div style={{ maxWidth: 860, margin: '0 auto' }}>
            <div style={{
              borderRadius: 20, padding: '26px 28px', marginBottom: 24,
              background: 'var(--payi-gradient-primary)', color: '#fff',
              boxShadow: '0 16px 32px rgba(37,99,235,0.18)',
            }}>
              <div style={{ fontSize: 13, opacity: 0.85, fontWeight: 600 }}>สวัสดี</div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 2 }}>
                {(() => { try { return JSON.parse(localStorage.getItem('payi-user') || 'null')?.name || 'Nook' } catch { return 'Nook' } })()}
              </div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>เลือกเมนูที่ต้องการด้านล่าง หรือกดจากแถบซ้าย</div>
            </div>

            {visibleMenuGroups.map((group) => (
              <div key={group.title} style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--payi-text-muted)', marginBottom: 10, letterSpacing: '0.02em' }}>
                  {group.title}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                  {group.items.map((item) => {
                    const Icon = item.renderIcon
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.group ? item.group[0] : item.id)}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
                          padding: '18px 12px', borderRadius: 16, textAlign: 'center',
                          border: '1px solid var(--payi-border)', background: 'var(--payi-surface)', cursor: 'pointer',
                          boxShadow: '0 6px 16px rgba(15,23,42,0.04)',
                        }}
                      >
                        <div style={{
                          width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center',
                          background: 'var(--payi-mint-soft)', color: 'var(--payi-mint-strong)',
                        }}>
                          {Icon && <Icon size={19} />}
                        </div>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--payi-text-strong)' }}>{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (activeTab === 'Executive') ? (
          <div style={{ width: '100%' }}>
            {/* HERO — ยอดขายรวม เด่นสุด ตัวใหญ่สุด เหมือนแอพธนาคารเปิดมาเจอยอดเงินก่อน */}
            <div style={{
              borderRadius: 20, padding: '26px 28px', marginBottom: 14,
              background: 'var(--payi-gradient-primary)', color: '#fff',
              boxShadow: '0 16px 36px rgba(37,99,235,0.22)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ fontSize: 13, opacity: 0.85, fontWeight: 700 }}>Total Revenue · {rangeLabel}</div>
                {fmtTrend(revenueTrend) && (
                  <span style={{
                    fontSize: 12.5, fontWeight: 800, padding: '3px 10px', borderRadius: 999,
                    background: 'rgba(255,255,255,0.18)',
                    color: (revenueTrend === null || revenueTrend >= 0) ? '#baffd9' : '#ffd0d0',
                  }}>{fmtTrend(revenueTrend)}</span>
                )}
              </div>
              <div style={{ fontSize: 42, fontWeight: 850, marginTop: 8, lineHeight: 1.05, letterSpacing: '-0.01em' }}>
                THB {fmt(totalRevenue)}
              </div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 8 }}>รวมยกเลิก/ตีคืน THB {fmt(totalGrossRevenue)}</div>
            </div>

            {/* รอง — Orders/Units/AOV/Ads/ROI สีต่างกันให้แยกง่ายด้วยตาแวบเดียว */}
            <div className="app-kpi-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${roiStats ? 5 : 3}, minmax(0, 1fr))`, gap: 12, marginBottom: 16 }}>
              {[
                { title: 'Orders', value: fmt(totalOrders), icon: ShoppingBag, color: '#2f6fe0', trend: fmtTrend(ordersTrend), isPositive: ordersTrend === null || ordersTrend >= 0 },
                { title: 'Units', value: fmt(totalQty), icon: Package, color: '#7a6fce', trend: fmtTrend(unitsTrend), isPositive: unitsTrend === null || unitsTrend >= 0 },
                { title: 'AOV', value: `THB ${fmt(avgOrder)}`, icon: TrendingUp, color: '#3f7f6f', trend: fmtTrend(aovTrend), isPositive: aovTrend === null || aovTrend >= 0 },
                ...(roiStats ? [
                  {
                    title: `ค่า Ads · ${roiStats.label}`,
                    value: `THB ${fmt(roiStats.ads || 0)}`,
                    note: selectedMonth ? `รวมทุกเดือน THB ${fmt(roiStats.totalAds || 0)}` : null,
                    icon: Megaphone, color: '#d64545',
                    onClick: () => setActiveTab('AdsChannels'),
                  },
                  {
                    title: `ROI · ${roiStats.label}`,
                    value: roiStats.roi !== null ? `${roiStats.roi.toFixed(1)}x` : '-',
                    // บอสงงว่า ROI ไปคิดรวมตัวแปรอื่นด้วยไหม — ใส่สูตรให้เห็นตรงๆ ในการ์ดเลย กันถามซ้ำ
                    note: `= ยอดขาย ÷ ค่า Ads${selectedMonth ? ` · รวมทุกเดือน ${roiStats.roiOverall !== null ? roiStats.roiOverall.toFixed(1) + 'x' : '-'}` : ''}`,
                    icon: Percent, color: '#1a9c6b',
                    onClick: () => setActiveTab('AdsChannels'),
                  },
                ] : []),
              ].map((item) => {
                const Icon = item.icon
                return (
                  <div key={item.title} onClick={item.onClick} className="app-stat-tile" style={{
                    background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 14, padding: '14px 16px', minHeight: 82,
                    boxShadow: '0 8px 20px rgba(15,23,42,0.04)', cursor: item.onClick ? 'pointer' : 'default',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <div style={{ width: 26, height: 26, borderRadius: 8, background: `${item.color}1a`, color: item.color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <Icon size={14} />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--payi-text-muted)', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: 18, lineHeight: 1.05, color: 'var(--payi-text-strong)', fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.value}</div>
                      {item.trend && (
                        <span style={{ fontSize: 10.5, fontWeight: 850, color: item.isPositive ? 'var(--payi-success)' : 'var(--payi-danger)', flexShrink: 0 }}>{item.trend}</span>
                      )}
                    </div>
                    {item.note && (
                      <div style={{ fontSize: 10, color: 'var(--payi-text-faint)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.note}</div>
                    )}
                  </div>
                )
              })}
            </div>
            {error && (
              <div style={{ background: 'var(--payi-danger-bg)', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: 'var(--payi-danger)', fontSize: 13 }}>
                ⚠️ โหลดไม่สำเร็จ: {error} — <button onClick={fetchDashboard} style={{ border: 'none', background: 'none', color: 'var(--payi-mint)', cursor: 'pointer', fontWeight: 600 }}>ลองใหม่</button>
              </div>
            )}

            {/* CONTROL PANEL */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16,
              background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', padding: '12px 14px', borderRadius: 8, marginBottom: 18,
              boxShadow: '0 8px 20px rgba(16,24,40,0.04)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <select
                  value={selectedMonth}
                  onChange={e => handleMonthChange(e.target.value)}
                  style={{ border: '1px solid var(--payi-border)', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: 'var(--payi-text)', outline: 'none', background: 'var(--payi-surface-muted)', fontWeight: 600 }}
                >
                  <option value="">ทั้งหมด (ทุกเดือน)</option>
                  {monthOptions.map(ym => <option key={ym} value={ym}>{monthLabel(ym)}</option>)}
                </select>
                {(startDate || endDate) && !selectedMonth && (
                  <button
                    onClick={() => { setStartDate(''); setEndDate(''); setDatePreset('all'); setBusiness('all'); setPlatform('all'); }}
                    style={{ background: 'none', border: 'none', color: 'var(--payi-danger)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 8px' }}
                  >
                    ล้างวันที่
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', background: 'var(--payi-border)', padding: 3, borderRadius: 8, border: '1px solid var(--payi-border)' }}>
                  {[
                    { id: 'today', label: 'วันนี้' },
                    { id: '7d', label: '7 วัน' },
                    { id: '30d', label: '30 วัน' },
                    { id: 'all', label: 'ทั้งหมด' }
                  ].map(p => {
                    const isSel = datePreset === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => handlePresetChange(p.id)}
                        style={{
                          padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer', transition: 'all 150ms ease',
                          background: isSel ? 'var(--payi-surface)' : 'transparent',
                          color: isSel ? 'var(--payi-mint)' : 'var(--payi-text)',
                          boxShadow: isSel ? '0 2px 8px rgba(15,23,42,0.05)' : 'none'
                        }}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>

                <select value={business} onChange={e => setBusiness(e.target.value)} style={{ border: '1px solid var(--payi-border)', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: 'var(--payi-text)', fontWeight: 500, outline: 'none', background: 'var(--payi-surface-muted)' }}>
                  <option value="all">ทุกธุรกิจ</option>
                  {businesses.map(b => <option key={b} value={b}>{b}</option>)}
                </select>

                <select value={platform} onChange={e => setPlatform(e.target.value)} style={{ border: '1px solid var(--payi-border)', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: 'var(--payi-text)', fontWeight: 500, outline: 'none', background: 'var(--payi-surface-muted)' }}>
                  <option value="all">ทุกแพลตฟอร์ม</option>
                  {platforms.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            {/* LOADING SKELETON */}
            {isFetching && !dashData && (
              <div style={{ position: 'relative', pointerEvents: 'none' }}>
                <div className="app-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 18, marginBottom: 24 }}>
                  {[1,2,3,4].map(i => <div key={i} className="payi-skeleton" style={{ height: 170 }} />)}
                </div>
                <div className="payi-skeleton" style={{ height: 290, marginBottom: 24 }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 24 }}>
                  <div className="payi-skeleton" style={{ height: 120 }} />
                  <div className="payi-skeleton" style={{ height: 120 }} />
                </div>
                <div className="payi-skeleton" style={{ height: 260 }} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 99, padding: '10px 20px', boxShadow: '0 8px 24px rgba(15,23,42,0.08)', fontSize: 13, color: 'var(--payi-text)', fontWeight: 500 }}>
                    <Loader2 size={16} className="payi-spin" />
                    กำลังโหลดข้อมูล...
                  </div>
                </div>
              </div>
            )}

            {/* CONTENT */}
            {dashData && (<>

            {/* REFRESHING INDICATOR */}
            {isFetching && (
              <div style={{ position: 'fixed', top: 18, right: 24, zIndex: 50, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 99, padding: '8px 16px', boxShadow: '0 8px 24px rgba(15,23,42,0.08)', fontSize: 12, color: 'var(--payi-text)', fontWeight: 500 }}>
                <Loader2 size={14} className="payi-spin" />
                กำลังอัปเดตข้อมูล...
              </div>
            )}

            {/* 1. ALERT CENTER - Full Width */}
            <AlertsSection alerts={alerts} />

            {/* 2. TRENDING ROW */}
            {trendCompare && (trendingUp.length > 0 || trendingDown.length > 0) && (
              <div style={{ fontSize: 12, color: 'var(--payi-text-faint)', marginBottom: 8, marginTop: -20 }}>
                เทียบยอดขายวันที่ 1-{trendCompare.latestDay} ของ{monthLabel(trendCompare.latestMonth)} กับวันที่ 1-{trendCompare.latestDay} ของ{monthLabel(trendCompare.prevMonth)} (ช่วงวันเท่ากัน)
              </div>
            )}
            <div className="app-two-col" style={{ display: 'flex', gap: 18, marginBottom: 28, flexWrap: 'wrap' }}>
              {/* Trending Up Card */}
              <TrendingCard title="Trending Up 🔥" items={trendingUp} isUp={true} />

              {/* Trending Down Card */}
              <TrendingCard title="Trending Down ⚠️" items={trendingDown} isUp={false} />
            </div>

            {/* GRAPH METRIC AREA */}
            <div style={{ background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 20, padding: '22px', marginBottom: 24, boxShadow: '0 10px 40px rgba(15,23,42,0.01)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--payi-text-strong)' }}>{activeChart.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--payi-text-faint)', marginTop: 4 }}>สถิติวิเคราะห์แนวโน้มการเติบโตแบบ Dynamic</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', background: 'var(--payi-border)', padding: 3, borderRadius: 8, border: '1px solid var(--payi-border)' }}>
                    {[
                      { id: 'daily',   label: 'รายวัน' },
                      { id: 'weekly',  label: 'สัปดาห์' },
                      { id: 'monthly', label: 'เดือน' },
                    ].map(p => (
                      <button key={p.id} onClick={() => setPeriod(p.id)} style={{
                        padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer',
                        background: period === p.id ? 'var(--payi-surface)' : 'transparent',
                        color: period === p.id ? 'var(--payi-mint)' : 'var(--payi-text)',
                        boxShadow: period === p.id ? '0 2px 8px rgba(15,23,42,0.05)' : 'none',
                        transition: 'all 150ms ease'
                      }}>{p.label}</button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6, background: 'var(--payi-border)', padding: 3, borderRadius: 8 }}>
                    {['revenue', 'orders'].map((mode) => (
                      <button key={mode} onClick={() => setChartMode(mode)} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: chartMode === mode ? 'var(--payi-mint)' : 'transparent', color: chartMode === mode ? 'var(--payi-surface)' : 'var(--payi-text)' }}>
                        {mode === 'revenue' ? 'Revenue' : 'Orders'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <defs>
                      <linearGradient id={`${chartMode}Gradient`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={activeChart.gradientFrom} stopOpacity={0.9} />
                        <stop offset="100%" stopColor={activeChart.gradientFrom} stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--payi-text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--payi-text-muted)' }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(56,189,248,0.04)' }} contentStyle={{ borderRadius: 12 }} formatter={activeChart.formatter} />
                    <Bar dataKey={chartMode} fill={`url(#${chartMode}Gradient)`} radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* PLATFORM BREAKDOWN */}
            <div style={{ background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 16, padding: '20px', marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--payi-text)' }}>สัดส่วนยอดขายตามแพลตฟอร์มรวม</div>
                {byPlatform.length > 0 && (
                  <button
                    onClick={() => exportToCsv('platform-breakdown.csv', byPlatform.map(p => ({
                      platform: p.name,
                      revenue: p.revenue,
                      percent: totalRevenue > 0 ? Math.round(p.revenue / totalRevenue * 100) : 0,
                    })))}
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--payi-text)', background: 'var(--payi-surface-muted)', border: '1px solid var(--payi-border)', borderRadius: 999, padding: '6px 14px', cursor: 'pointer' }}
                  >
                    ⬇ Export CSV
                  </button>
                )}
              </div>
              {byPlatform.map((p, i) => {
                const pct = totalRevenue > 0 ? Math.round(p.revenue / totalRevenue * 100) : 0
                const isActive = platform === p.name
                return (
                  <div
                    key={p.name}
                    onClick={() => setPlatform(isActive ? 'all' : p.name)}
                    title={isActive ? 'คลิกเพื่อยกเลิกกรอง' : `คลิกเพื่อกรองเฉพาะ ${p.name}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', margin: '0 -8px',
                      borderBottom: i < byPlatform.length - 1 ? '1px solid var(--payi-border)' : 'none',
                      cursor: 'pointer', borderRadius: 8,
                      background: isActive ? 'var(--payi-mint-soft)' : 'transparent',
                      transition: 'background-color 150ms ease'
                    }}
                  >
                    <div style={{ width: 100, fontSize: 12, fontWeight: isActive ? 700 : 500, color: isActive ? 'var(--payi-mint)' : 'var(--payi-text-strong)' }}>{p.name}</div>
                    <div style={{ flex: 1, height: 7, background: 'var(--payi-border)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: PLATFORM_COLORS[p.name] || '#888', width: `${pct}%`, transition: 'width 0.4s ease' }} />
                    </div>
                    <div style={{ width: 36, fontSize: 11, textAlign: 'right', color: 'var(--payi-text-faint)', fontWeight: 500 }}>{pct}%</div>
                    <div style={{ width: 110, fontSize: 12, textAlign: 'right', fontWeight: 600 }}>฿{fmt(p.revenue)}</div>
                  </div>
                )
              })}
            </div>

            {/* TOP SKUs HEADER */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--payi-text-muted)' }}>
                  สินค้าขายดีติดอันดับ (Top 10 by Revenue · รวมไซส์/รุ่นย่อยเป็นสินค้าเดียว)
                </span>
                <span style={{ fontSize: 11, color: 'var(--payi-mint)', background: 'var(--payi-mint-soft)', padding: '2px 8px', borderRadius: 999, fontWeight: 500 }}>✨ กดที่แถวเพื่อดูสัดส่วนยอดขายจริงช่องทางย่อย</span>
                {searchQuery && (
                  <span style={{ fontSize: 11, color: 'var(--payi-text-faint)' }}>ผลการค้นหา "{searchQuery}": {filteredSkus.length} รายการ</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {filteredSkus.length > 0 && (
                  <button
                    onClick={() => exportToCsv('top-skus.csv', filteredSkus.map(s => ({
                      display_name: s.display_name,
                      sku_count: s.skuCount,
                      skus: s.skus.join('; '),
                      orders: s.orders,
                      qty: s.qty,
                      revenue: s.revenue,
                    })))}
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--payi-text)', background: 'var(--payi-surface-muted)', border: '1px solid var(--payi-border)', borderRadius: 999, padding: '6px 14px', cursor: 'pointer' }}
                  >
                    ⬇ Export CSV
                  </button>
                )}
                {filteredSkus.length > 0 && (
                  <button
                    onClick={() => setShowSkuModal(true)}
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--payi-mint)', background: 'var(--payi-mint-soft)', border: '1px solid var(--payi-line)', borderRadius: 999, padding: '6px 14px', cursor: 'pointer' }}
                  >
                    {`ดูทั้งหมด (${filteredSkus.length})`}
                  </button>
                )}
              </div>
            </div>

            {/* TOP PERFORMANCE SKUs TABLE */}
            <div style={{ background: 'var(--payi-surface)', border: '1px solid var(--payi-border)', borderRadius: 16, overflowX: 'auto', marginBottom: 40, boxShadow: '0 4px 20px rgba(0,0,0,0.01)' }}>
              <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'var(--payi-surface-muted)', borderBottom: '1px solid var(--payi-border)' }}>
                    <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--payi-text)', fontSize: 11, textAlign: 'center' }}>SKU</th>
                    <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--payi-text)', fontSize: 11 }}>ชื่อสินค้า</th>
                    <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--payi-text)', fontSize: 11, textAlign: 'right' }}>จำนวนออเดอร์</th>
                    <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--payi-text)', fontSize: 11, textAlign: 'right' }}>จำนวนชิ้น</th>
                    <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--payi-text)', fontSize: 11, textAlign: 'right' }}>ยอดขายรวม</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSkus.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--payi-text-faint)', fontSize: 13 }}>
                        ไม่พบสินค้าที่ตรงกับ "{searchQuery}"
                      </td>
                    </tr>
                  )}
                  {visibleSkus.map((s) => (
                    <tr
                      key={s.key}
                      onClick={() => { setSelectedSkuData(s); setIsDrawerOpen(true); }}
                      className="payi-interactive-row"
                      style={{ borderBottom: '1px solid var(--payi-border)', cursor: 'pointer', transition: 'background-color 150ms ease' }}
                    >
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--payi-mint-soft)', color: 'var(--payi-mint-strong)' }}>{s.skuCount}</span>
                      </td>
                      <td style={{ padding: '14px 16px', color: 'var(--payi-text-strong)', fontWeight: 500 }}>{s.display_name}</td>
                      <td style={{ padding: '14px 16px', color: 'var(--payi-text)', textAlign: 'right' }}>{fmt(s.orders)}</td>
                      <td style={{ padding: '14px 16px', color: 'var(--payi-text)', textAlign: 'right' }}>{fmt(s.qty)}</td>
                      <td style={{ padding: '14px 16px', color: 'var(--payi-text-strong)', fontWeight: 600, textAlign: 'right' }}>฿{fmt(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </>)}
          </div>
        ) : null}

        {/* แท็บพวกนี้ mount ค้างไว้เมื่อเคยเปิดแล้ว (ซ่อนด้วย CSS แทนการ unmount) กัน fetch ข้อมูลซ้ำทุกครั้งที่กดสลับแท็บไปมา */}
        {[
          ['Monthly', <MonthlyDashboard />],
          ['FeedProducts', <FeedProducts dashData={dashData} loading={isFetching} error={error} onRetry={fetchDashboard} />],
          ['Products', <ProductDashboard />],
          ['ProductTrends', <ProductTrends />],
          ['AdsChannels', <AdsChannels />],
          ['ContentOS', <ContentOSPrototype />],
          ['MarketingRadar', <MarketingRadar />],
          ['Planner Control', <PlannerControl onNavigate={setActiveTab} />],
          ['Inventory', <Inventory />],
          ['Import Tracking', <ImportTracking />],
          ['Stock Movement', <StockMovement />],
          ['Workforce OT', <WorkforceOT />],
          ['HR', <HR />],
          ['Claims', <ClaimView />],
          ['Import Orders', <Upload onNavigate={handleNavigate} />],
          ['Links Hub', <LinksHub />],
          ['Dev Hub', <DevHub />],
          ['Settings', <Settings />],
        ].map(([id, node]) => visitedTabs.has(id) && (
          <div key={id} style={{ display: activeTab === id ? 'block' : 'none' }}>{node}</div>
        ))}

        {!KNOWN_TABS.has(activeTab) && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--payi-text-faint)' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 16, color: 'var(--payi-line)' }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <div style={{ fontSize: '15px', fontWeight: '500', color: 'var(--payi-text)' }}>โมดูล {activeTab} กำลังจัดเตรียมโครงสร้างคลังข้อมูล</div>
          </div>
        )}
        </Suspense>
      </div>

      {/* PRODUCT INSIGHT SIDE DRAWER */}
      <ProductInsightDrawer
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setSelectedSkuData(null);
        }}
        selectedSku={selectedSkuData}
      />

      {/* BOTTOM TAB BAR — มือถือเท่านั้น (เช็ค isMobileViewport ตรงๆ เหตุผลเดียวกับ sidebar ด้านบน) แทน sidebar ทั้งหมด สไตล์แอพธนาคาร ลอยมนใส */}
      {isMobileViewport && (
      <nav className="payi-bottom-tabbar">
        {mobileTabItems.map((item) => {
          const isActive = item.group ? item.group.includes(activeTab) : activeTab === item.id
          const Icon = item.renderIcon
          return (
            <button key={item.id} onClick={() => setActiveTab(item.id)} className="payi-bottom-tab" aria-label={item.label}>
              <span className={isActive ? 'payi-bottom-tab-icon active' : 'payi-bottom-tab-icon'}><Icon size={19} /></span>
              <span className="payi-bottom-tab-label" style={{ color: isActive ? 'var(--payi-mint-strong)' : undefined, fontWeight: isActive ? 800 : 650 }}>{item.label}</span>
            </button>
          )
        })}
        {!showAllTabsDirect && (
          <button onClick={() => setMobileMoreOpen(true)} className="payi-bottom-tab" aria-label="เมนูเพิ่มเติม">
            <span className={mobileMoreOpen ? 'payi-bottom-tab-icon active' : 'payi-bottom-tab-icon'}><Menu size={19} /></span>
            <span className="payi-bottom-tab-label" style={{ color: mobileMoreOpen ? 'var(--payi-mint-strong)' : undefined, fontWeight: mobileMoreOpen ? 800 : 650 }}>เมนู</span>
          </button>
        )}
      </nav>
      )}

      {/* MORE SHEET — มือถือ: รายการเมนูทั้งหมด เลื่อนขึ้นจากล่าง แทนที่ sidebar drawer เดิม */}
      {!showAllTabsDirect && mobileMoreOpen && (
        <div className="payi-more-backdrop" onClick={() => setMobileMoreOpen(false)}>
          <div className="payi-more-sheet" onClick={(e) => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, borderRadius: 999, background: 'var(--payi-border)', margin: '0 auto 16px' }} />
            <div style={{ fontSize: 15, fontWeight: 850, color: 'var(--payi-text-strong)', marginBottom: 14 }}>เมนูทั้งหมด</div>
            {visibleMenuGroups.map((group) => (
              <div key={group.title} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--payi-text-faint)', letterSpacing: '.06em', marginBottom: 6, textTransform: 'uppercase' }}>{group.title}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {group.items.map((item) => {
                    const isActive = item.group ? item.group.includes(activeTab) : activeTab === item.id
                    return (
                      <button
                        key={item.id}
                        onClick={() => { setActiveTab(item.id); setMobileMoreOpen(false) }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', border: 'none', borderRadius: 12,
                          background: isActive ? 'var(--payi-mint-soft)' : 'transparent', color: isActive ? 'var(--payi-mint-strong)' : 'var(--payi-text-strong)',
                          fontSize: 14, fontWeight: isActive ? 800 : 650, textAlign: 'left', cursor: 'pointer',
                        }}
                      >
                        <item.renderIcon size={18} />
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
