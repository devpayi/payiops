import {useEffect,useState} from 'react'

export const notifyMarketingInputsChanged=()=>window.dispatchEvent(new Event('marketing-inputs-changed'))

export default function useMarketingRead(kind) {
  const [state,setState]=useState({loading:true,data:null,error:'',denied:false})
  const [version,setVersion]=useState(0)
  useEffect(()=>{
    const refresh=()=>setVersion(value=>value+1)
    window.addEventListener('marketing-inputs-changed',refresh)
    return ()=>window.removeEventListener('marketing-inputs-changed',refresh)
  },[])
  useEffect(()=>{
    const controller=new AbortController()
    fetch(`/api/marketing?kind=${encodeURIComponent(kind)}`,{signal:controller.signal}).then(async response=>{
      if(controller.signal.aborted)return
      if(response.status===401 || response.status===403) {setState({loading:false,data:null,error:'บัญชีนี้ไม่มีสิทธิ์อ่านข้อมูลส่วนนี้',denied:true});return}
      const data=await response.json()
      if(!response.ok || !data.success)throw Error(data.error || 'อ่านข้อมูลไม่สำเร็จ')
      if(!controller.signal.aborted)setState({loading:false,data,error:'',denied:false})
    }).catch(error=>{if(!controller.signal.aborted)setState({loading:false,data:null,error:error.message || 'อ่านข้อมูลไม่สำเร็จ',denied:false})})
    return ()=>controller.abort()
  },[kind,version])
  return {...state,refresh:()=>setVersion(value=>value+1)}
}
