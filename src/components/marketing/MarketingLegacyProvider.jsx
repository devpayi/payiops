import {lazy,Suspense,useCallback,useMemo,useState} from 'react'
import {createPortal} from 'react-dom'
import {MarketingLegacyContext} from './marketingLegacyContext.js'
import {notifyMarketingInputsChanged} from '../../hooks/useMarketingRead.js'
const Editor=lazy(()=>import('../../pages/AdsChannels.jsx'))

// A single editor owns the legacy monthly snapshot and the existing POST path.
// Portals move its UI between tabs without creating a second stale writer.
export default function MarketingLegacyProvider({children}) {
  const [destination,setDestination]=useState(null)
  const activate=useCallback((target,surface)=>setDestination(previous=>previous?.target===target&&previous.surface===surface?previous:{target,surface}),[])
  const context=useMemo(()=>({activate}),[activate])
  return <MarketingLegacyContext.Provider value={context}>
    {children}
    {destination&&<Suspense fallback={createPortal(<p role="status">กำลังเปิดแบบฟอร์ม…</p>,destination.target)}><Editor portalTarget={destination.target} surface={destination.surface} onSaved={notifyMarketingInputsChanged}/></Suspense>}
  </MarketingLegacyContext.Provider>
}
