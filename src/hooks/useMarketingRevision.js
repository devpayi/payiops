import {useEffect,useState} from 'react'

// All mounted readers keep their existing sources and reload after legacy saves.
export default function useMarketingRevision() {
  const [revision,setRevision]=useState(0)
  useEffect(()=>{
    const update=()=>setRevision(value=>value+1)
    window.addEventListener('marketing-inputs-changed',update)
    return ()=>window.removeEventListener('marketing-inputs-changed',update)
  },[])
  return revision
}
