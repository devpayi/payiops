import { HttpError } from '../../http/errors.js';
export function record(value: unknown): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400,'INVALID_INPUT','ข้อมูลต้องเป็น JSON object');
 return value as Record<string, unknown>;
}
export function string(value: unknown, field: string, max=500): string {
 if(typeof value!=='string'||!value.trim()||value.length>max) throw new HttpError(400,'INVALID_INPUT',`กรุณาตรวจ ${field}`);
 return value.trim();
}
export function id(value: unknown): string {
 const result=string(value,'รหัส',36).toLowerCase();
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(result)) throw new HttpError(400,'INVALID_ID','รหัสไม่ถูกต้อง');
 return result;
}
export function amount(value: unknown, zero=false): string {
 const result=string(value,'จำนวนเงิน',18);
 if(!/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(result)||(!zero&&Number(result)===0)) throw new HttpError(400,'INVALID_AMOUNT','จำนวนเงินต้องเป็นบวกและมีทศนิยมไม่เกิน 2 ตำแหน่ง');
 return result;
}
export function date(value: unknown): string {
 const result=string(value,'วันที่',10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(result)||!Number.isFinite(Date.parse(result))||new Date(result).toISOString().slice(0,10)!==result) throw new HttpError(400,'INVALID_DATE','วันที่ไม่ถูกต้อง');
 return result;
}
export function bangkokDate(now=new Date()): string { return new Date(now.getTime()+25200000).toISOString().slice(0,10); }
export const locations=['MARKETPLACE','MAKRO','LOCAL_SHOP','MAIN_HOUSE'] as const;
export type Location=typeof locations[number];
export const locationNames:Record<Location,string>={MARKETPLACE:'Shopee / Lazada',MAKRO:'แม็คโคร',LOCAL_SHOP:'ร้านหน้าปากซอย',MAIN_HOUSE:'หยิบจากบ้านใหญ่'};
export function location(value:unknown):Location {
 if(!locations.includes(value as Location)) throw new HttpError(400,'INVALID_LOCATION','เลือกสถานที่ซื้อ');
 return value as Location;
}
export function shopUrl(value: unknown): string|null {
 if(value===null||value===undefined||value==='')return null;
 try {const u=new URL(string(value,'ลิงก์ร้านค้า',2000));if(u.protocol!=='https:'||u.username||u.password)throw new Error();return u.href;}
 catch{throw new HttpError(400,'INVALID_URL','ลิงก์ร้านค้าต้องเป็น HTTPS');}
}
