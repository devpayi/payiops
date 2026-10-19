import {useCallback,useEffect,useState} from 'react'

const endpoint='/api/marketing?kind=ad-product-mappings'
export default function useAdProductMappings(active=true) {
  const [state,setState]=useState({loading:true,saving:false,error:'',data:null})
  const refresh=useCallback(async(signal)=>{
    setState(previous=>({...previous,loading:true,error:''}))
    try{
      const response=await fetch(endpoint,{signal}),data=await response.json()
      if(!response.ok||!data.success)throw Error(data.error||'อ่านข้อมูล Map ไม่สำเร็จ')
      if(!signal?.aborted)setState(previous=>({...previous,loading:false,data,error:''}))
      return data
    }catch(error){if(!signal?.aborted)setState(previous=>({...previous,loading:false,error:error.message}));throw error}
  },[])
  useEffect(()=>{
    if(!active)return
    const controller=new AbortController()
    refresh(controller.signal).catch(()=>{})
    return ()=>controller.abort()
  },[active,refresh])
  const save=async payload=>{
    setState(previous=>({...previous,saving:true,error:''}))
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),result=await response.json()
      if(!response.ok||!result.success)throw Error(result.error||'บันทึก Map ไม่สำเร็จ')
      setState(previous=>({...previous,saving:false,data:{...previous.data,mappings:result.mappings},error:''}))
      return result
    }catch(error){setState(previous=>({...previous,saving:false,error:error.message}));throw error}
  }
  return {...state,save,refresh:()=>refresh()}
}
