import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
export const dynamic='force-dynamic';
interface Catalog {company:{legal_name:string};products:{id:string;name:string;description:string;price_ex_vat:string;unit:string}[]}
async function catalog(companyId:string):Promise<Catalog>{
 if(!/^[a-f0-9-]{36}$/.test(companyId))notFound();
 const result=await fetch(`${process.env['CORE_URL']??'http://127.0.0.1:3001'}/catalog/${companyId}`,{cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(result.status===404)notFound();if(!result.ok)throw new Error('Catalog unavailable');return result.json() as Promise<Catalog>;
}
export async function generateMetadata({params}:{params:Promise<{companyId:string}>}):Promise<Metadata>{const data=await catalog((await params).companyId);return{title:`สินค้า · ${data.company.legal_name}`,description:`แคตตาล็อกสินค้าของ ${data.company.legal_name}`,robots:{index:true,follow:true}};}
export default async function CatalogPage({params}:{params:Promise<{companyId:string}>}){
 const data=await catalog((await params).companyId);
 return <main className="catalog"><div className="wordmark">MONA <span>CATALOG</span></div><h1>{data.company.legal_name}</h1><p>สินค้าและราคาก่อนภาษีมูลค่าเพิ่ม</p>{data.products.length?<div className="catalog-grid">{data.products.map(p=><article className="card" key={p.id}><span className="eyebrow">{p.unit}</span><h2>{p.name}</h2><p>{p.description}</p><strong className="price">฿{Number(p.price_ex_vat).toLocaleString('th-TH',{minimumFractionDigits:2})}</strong></article>)}</div>:<div className="empty">ยังไม่มีสินค้าที่เปิดเผยแพร่ในแคตตาล็อก</div>}</main>;
}
