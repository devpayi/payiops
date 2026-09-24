// Read-only Google Sheets snapshot. Never prints credentials or row contents.
import fs from 'node:fs/promises';
import { batchGetValues } from '../api/_lib/sheets.js';
const month=process.argv[2] || '2026-08';
if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Expected YYYY-MM');
const tab=`raw_orders_${month.replace('-','_')}`;
let result;
try { [result]=await batchGetValues([`'${tab}'!A:V`]); }
catch { console.error('Read-only Sheets export failed; check network and local credentials.'); process.exit(1); }
if(!result?.values?.length)throw Error('Source empty');
await fs.mkdir('tmp/orders-sqlite',{recursive:true});
const path=`tmp/orders-sqlite/${month}.json`;
await fs.writeFile(path,JSON.stringify({tab,month,fetched_at:new Date().toISOString(),values:result.values}));
console.log(JSON.stringify({path,tab,rows:result.values.length-1}));
