import {useState} from 'react'
import {RotateCcw} from 'lucide-react'
import TikTokSalesChannels from '../components/marketing/TikTokSalesChannels.jsx'
import useMarketingRead from '../hooks/useMarketingRead.js'
import {previousMarketingMonth} from '../../shared/marketingReadModels.js'
import './MarketingMonthlyPreview.css'
import MarketingLegacyHost from '../components/marketing/MarketingLegacyHost.jsx'

function lastMonth(){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',timeZone:'Asia/Bangkok'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return previousMarketingMonth(`${parts.year}-${parts.month}`)}
export default function TikTokSalesDashboard({active=true}) {
  const [view,setView]=useState('overview')
  const source=useMarketingRead('sales-channels-read')
  const [month,setMonth]=useState(lastMonth)
  const [business,setBusiness]=useState('Payi')
  const recent=[lastMonth()]
  for(let i=1;i<12;i++)recent.push(previousMarketingMonth(recent.at(-1)))
  const months=[...new Set([month,...recent,...(source.data?.months || []).filter(m=>/^\d{4}-(0[1-9]|1[0-2])$/.test(m))])].sort().reverse()
  return <div className="mm-page mm-embedded">
    <nav className="mm-workspace-nav" aria-label="ช่องทางขาย TikTok"><button aria-pressed={view==='overview'} onClick={()=>setView('overview')}>ภาพรวม</button><button aria-pressed={view==='edit'} onClick={()=>setView('edit')}>กรอกยอด TikTok</button></nav>
    <div hidden={view!=='overview'}>
    <div className="mm-tiktok-toolbar"><fieldset className="mm-filters"><label>เดือนปฏิทิน<select value={month} onChange={e=>setMonth(e.target.value)}>{months.map(m=><option key={m} value={m}>{new Intl.DateTimeFormat('th-TH',{month:'long',year:'numeric',timeZone:'Asia/Bangkok'}).format(new Date(`${m}-01T00:00:00Z`))}</option>)}</select></label><label>ธุรกิจ<select value={business} onChange={e=>setBusiness(e.target.value)}>{['Payi','Payi Outlet','กรอบรูป'].map(b=><option key={b}>{b}</option>)}</select></label></fieldset><button onClick={source.refresh}><RotateCcw size={15}/> โหลดข้อมูลเดิมใหม่</button></div>
    {source.loading&&<p role="status">กำลังอ่านยอดที่กรอกไว้เดิม…</p>}
    {source.error&&<p className="mm-feedback mm-error" role="alert">{source.error}</p>}
    {!source.denied&&<TikTokSalesChannels month={month} business={business} legacyInputs={source.data?.inputs ?? null}/>}
    </div>
    <div hidden={view!=='edit'}><MarketingLegacyHost active={active&&view==='edit'} surface="tiktok"/></div>
  </div>
}
