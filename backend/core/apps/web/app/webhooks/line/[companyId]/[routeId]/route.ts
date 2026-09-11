import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request: NextRequest, context: {params: Promise<{companyId:string;routeId:string}>}): Promise<Response> {
 const {companyId,routeId}=await context.params;
 if(!uuid.test(companyId)||!uuid.test(routeId))return new Response(null,{status:404});
 const signature=request.headers.get('x-line-signature');
 if(!signature)return new Response(null,{status:401});
 if(request.headers.get('content-encoding') && request.headers.get('content-encoding')!=='identity')return new Response(null,{status:415});
 if(request.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')return new Response(null,{status:415});
 const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400});
 try {
  const chunks:Uint8Array[]=[];let length=0;
  for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>262144){await reader.cancel();return new Response(null,{status:413});}chunks.push(part.value);}
  const response=await fetch((process.env['CORE_URL']??'http://127.0.0.1:3001')+'/webhooks/line/'+companyId+'/'+routeId,{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':signature},body:Buffer.concat(chunks),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(45000)});
  return new Response(await response.arrayBuffer(),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 } catch {return NextResponse.json({message:'Webhook service unavailable'},{status:502});}
 finally {reader.releaseLock();}
}
