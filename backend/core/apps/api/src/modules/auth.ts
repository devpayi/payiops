import { randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import { importPKCS8, SignJWT } from 'jose';
import { sql, type TenantDatabase } from '../../../../packages/db/src/index.js';
import { HttpError } from '../http/errors.js';
import { id, record, string } from './procurement/input.js';
const scrypt=promisify(derive);
export async function hashPassword(password:string,salt=randomBytes(24).toString('hex')):Promise<{salt:string;hash:string}>{
 return{salt,hash:(await scrypt(password,salt,64) as Buffer).toString('hex')};
}
export interface LocalAuth {privateKey:string;kid:string;issuer:string;audience:string}
export function authRoutes(db:TenantDatabase,config:LocalAuth):Router{
 const router=Router(),attempts=new Map<string,{count:number;until:number}>();
 router.post('/login',async(req,res)=>{
  const ip=req.ip??'local',now=Date.now();for(const[key,value]of attempts)if(value.until<now)attempts.delete(key);
  const counter=attempts.get(ip)??{count:0,until:now+60000};counter.count++;attempts.set(ip,counter);
  if(counter.count>10||attempts.size>10000)throw new HttpError(429,'TOO_MANY_ATTEMPTS','ลองเข้าสู่ระบบใหม่ในอีก 1 นาที');
  const b=record(req.body),company=id(b['companyId']),username=string(b['username'],'ชื่อผู้ใช้',120).toLowerCase(),password=string(b['password'],'รหัสผ่าน',256);
  const result=await db.runAsTenant(company,()=>db.transaction(async()=>{
   const user=(await db.query<{id:string;auth_subject:string;password_hash:string;salt:string;locked_until:Date|null}>(sql`SELECT u.id,u.auth_subject,c.password_hash,c.salt,c.locked_until FROM app.users u JOIN app.local_credentials c ON c.company_id=u.company_id AND c.user_id=u.id JOIN app.companies co ON co.company_id=u.company_id AND co.status='ACTIVE' WHERE u.company_id=${company} AND u.auth_subject=${username} AND u.auth_issuer=${config.issuer} AND u.status='ACTIVE' FOR UPDATE OF c`)).rows[0];
   const derived=await hashPassword(password,user?.salt??'authentication-dummy-salt');
   const expected=Buffer.from(user?.password_hash??'00'.repeat(64),'hex'),actual=Buffer.from(derived.hash,'hex');
   const matches=expected.length===actual.length&&timingSafeEqual(expected,actual);
   if(!user||user.locked_until&&user.locked_until.getTime()>now)return null;
   if(!matches){await db.query(sql`UPDATE app.local_credentials SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts>=4 THEN now()+interval '5 minutes' ELSE NULL END WHERE company_id=${company} AND user_id=${user.id}`);return null;}
   await db.query(sql`UPDATE app.local_credentials SET failed_attempts=0,locked_until=NULL WHERE company_id=${company} AND user_id=${user.id}`);return user;
  }));
  if(!result)throw new HttpError(401,'INVALID_LOGIN','ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกพักชั่วคราว');
  const key=await importPKCS8(config.privateKey,'RS256');
  const token=await new SignJWT({company_id:company}).setProtectedHeader({alg:'RS256',kid:config.kid}).setIssuer(config.issuer).setAudience(config.audience).setSubject(result.auth_subject).setIssuedAt().setExpirationTime('1h').sign(key);
  res.json({token,expiresIn:3600});
 });return router;
}
