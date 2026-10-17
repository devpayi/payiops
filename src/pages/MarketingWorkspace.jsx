import {useState} from 'react'
import {FolderOpen,PencilLine,RotateCcw} from 'lucide-react'
import MarketingMonthlyPreview from './MarketingMonthlyPreview.jsx'
import useMarketingRead from '../hooks/useMarketingRead.js'
import MarketingLegacyHost from '../components/marketing/MarketingLegacyHost.jsx'

export default function MarketingWorkspace({active=true}) {
  const [view,setView]=useState('reports')
  const [legacyOpened,setLegacyOpened]=useState(false)
  const source=useMarketingRead('monthly-reports')
  // The monthly reports have no production store yet: when the API says they are not
  // available (or this account may not read them), the manual ad-cost form is the page.
  const reportsShown=source.loading || (Boolean(source.error) && !source.denied) || Boolean(source.data?.available)
  const current=reportsShown?view:'legacy'
  function openLegacy(){setLegacyOpened(true);setView('legacy')}
  return <section className="mm-workspace">
    <nav className="mm-workspace-nav" aria-label="หน้าวิเคราะห์โฆษณา">
      {reportsShown&&<button aria-pressed={current==='reports'} onClick={()=>setView('reports')}><FolderOpen size={17}/> รายงานรายเดือน</button>}
      <button aria-pressed={current==='legacy'} onClick={openLegacy}><PencilLine size={17}/> กรอกค่าแอด</button>
      {reportsShown&&current==='reports'&&<button className="mm-refresh" onClick={source.refresh}><RotateCcw size={15}/> รีเฟรช</button>}
    </nav>
    {reportsShown&&<div hidden={current!=='reports'}><MarketingMonthlyPreview embedded serverReports={source.data?.reports || []} sourceLoading={source.loading} sourceError={source.error} denied={source.denied}/></div>}
    {(legacyOpened||!reportsShown)&&<div hidden={current!=='legacy'}><MarketingLegacyHost active={active&&current==='legacy'} surface="ads"/></div>}
  </section>
}
