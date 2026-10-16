import {useState} from 'react'
import {FolderOpen,PencilLine,RotateCcw} from 'lucide-react'
import MarketingMonthlyPreview from './MarketingMonthlyPreview.jsx'
import useMarketingRead from '../hooks/useMarketingRead.js'
import MarketingLegacyHost from '../components/marketing/MarketingLegacyHost.jsx'

export default function MarketingWorkspace({active=true}) {
  const [view,setView]=useState('reports')
  const [legacyOpened,setLegacyOpened]=useState(false)
  const source=useMarketingRead('monthly-reports')
  function openLegacy(){setLegacyOpened(true);setView('legacy')}
  return <section className="mm-workspace">
    <nav className="mm-workspace-nav" aria-label="หน้าวิเคราะห์โฆษณา">
      <button aria-pressed={view==='reports'} onClick={()=>setView('reports')}><FolderOpen size={17}/> รายงานรายเดือน</button>
      <button aria-pressed={view==='legacy'} onClick={openLegacy}><PencilLine size={17}/> กรอกค่าแอด</button>
      {view==='reports'&&<button className="mm-refresh" onClick={source.refresh}><RotateCcw size={15}/> รีเฟรช</button>}
    </nav>
    <div hidden={view!=='reports'}><MarketingMonthlyPreview embedded serverReports={source.data?.reports || []} sourceLoading={source.loading} sourceError={source.error} denied={source.denied}/></div>
    {legacyOpened&&<div hidden={view!=='legacy'}><MarketingLegacyHost active={active&&view==='legacy'} surface="ads"/></div>}
  </section>
}
