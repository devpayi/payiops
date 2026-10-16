import {useContext,useEffect,useRef} from 'react'
import {MarketingLegacyContext} from './marketingLegacyContext.js'

export default function MarketingLegacyHost({active,surface}) {
  const host=useRef(null)
  const context=useContext(MarketingLegacyContext)
  useEffect(()=>{
    if(active&&host.current)context?.activate(host.current,surface)
  },[active,surface,context])
  return <div ref={host}/>
}
