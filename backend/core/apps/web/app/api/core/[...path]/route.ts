import { NextRequest,NextResponse } from 'next/server';
export const dynamic='force-dynamic';
async function proxy(request:NextRequest,context:{params:Promise<{path:string[]}>}):Promise<Response>{
 const parts=(await context.params).path;
 if(parts.some(p=>!/^[-a-zA-Z0-9]+$/.test(p)))return NextResponse.json({message:'เส้นทางไม่ถูกต้อง'},{status:400});
 const path=parts.join('/'),write=request.method!=='GET';
 const publicOrigin=process.env['PUBLIC_WEB_URL']??request.nextUrl.origin;
 if(write&&(request.headers.get('origin')!==publicOrigin||request.headers.get('x-requested-with')!=='mona'))return NextResponse.json({message:'คำขอไม่ผ่านการตรวจสอบต้นทาง'},{status:403});
 if(path==='logout'){const out=NextResponse.json({ok:true});out.cookies.delete('mona_session');return out;}
 if(path!=='auth/login'&&!path.startsWith('api/'))return NextResponse.json({message:'ไม่พบ API'},{status:404});
 const token=request.cookies.get('mona_session')?.value;
 if(path!=='auth/login'&&!token)return NextResponse.json({message:'กรุณาเข้าสู่ระบบ'},{status:401});
 try{
  const body=write?await request.text():undefined;if(body&&body.length>8000000)return NextResponse.json({message:'ไฟล์ใหญ่เกินไป'},{status:413});
  const upstream=await fetch(`${process.env['CORE_URL']??'http://127.0.0.1:3001'}/${path}`,{method:request.method,headers:{...(token?{Authorization:`Bearer ${token}`}:{'Content-Type':'application/json'}),'Content-Type':'application/json'},...(body!==undefined?{body}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(45000)});
  if(path==='auth/login'&&upstream.ok){const result=await upstream.json() as {token:string};const out=NextResponse.json({ok:true});out.cookies.set('mona_session',result.token,{httpOnly:true,sameSite:'strict',secure:new URL(publicOrigin).protocol==='https:',path:'/',maxAge:3600});return out;}
  return new Response(await upstream.arrayBuffer(),{status:upstream.status,headers:{'Content-Type':upstream.headers.get('content-type')??'application/json','Cache-Control':'no-store'}});
 }catch{return NextResponse.json({message:'ติดต่อระบบบัญชีไม่ได้ กรุณาตรวจว่า Core เปิดอยู่'},{status:502});}
}
export const GET=proxy;export const POST=proxy;
