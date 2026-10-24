import { DatabaseSync } from 'node:sqlite'
import handler from '../../api/products.js'
import { getSheet } from '../../api/_lib/sheets.js'
import { deriveGroup, buildOverrideMap } from '../../api/_lib/productGroup.js'
import { getSkuRedirectMap, getSetRecipeKeySet, resolveSalesSku, SET_RECIPES_SHEET } from '../../api/_lib/skuMapping.js'
const call = async (q) => { let body; const t=performance.now(); await handler({ method:'GET', query:q, headers:{} }, { setHeader(){}, status(){return this}, json(b){body=b} }); return { body, ms: Math.round(performance.now()-t) } }
const db = new DatabaseSync(process.argv[2])
const aliasRows = await getSheet('product_aliases'); const overrideMap = buildOverrideMap(aliasRows)
const [redirectMap, recipeKeySet, setRecipeRows] = await Promise.all([getSkuRedirectMap(), getSetRecipeKeySet(), getSheet(SET_RECIPES_SHEET).catch(()=>[])])
const nameBySku = new Map(); for (const r of aliasRows){const s=String(r.master_sku||'').trim().toUpperCase(); if(s&&!nameBySku.has(s)) nameBySku.set(s,String(r.display_name||'').trim()||s)}
const recipes = new Map(); for (const r of setRecipeRows){const a=String(r.set_sku||'').trim().toUpperCase(),v=String(r.variation_name||'').trim(),c=String(r.component_sku||'').trim().toUpperCase(),q=Number(r.qty_per_unit)||0; if(!a||!v||!c||q<=0)continue; const k=a+'|'+v; if(!recipes.has(k))recipes.set(k,[]); recipes.get(k).push({c,q})}
// map distinct (variation, sku, name) -> resolved sku + group key
db.exec('DROP TABLE IF EXISTS cmap; CREATE TEMP TABLE cmap(variation_name,master_sku,display_name,rsku,gkey,glabel)')
const ins = db.prepare('INSERT INTO cmap VALUES(?,?,?,?,?,?)')
const combos = db.prepare('SELECT DISTINCT variation_name,master_sku,display_name FROM orders').all()
for (const c of combos){ const rsku=resolveSalesSku(c.master_sku,c.variation_name,redirectMap,recipeKeySet); const g=deriveGroup(c.display_name,rsku,overrideMap); ins.run(c.variation_name,c.master_sku,c.display_name,rsku,g.key,g.label) }
db.exec('CREATE INDEX cm ON cmap(variation_name,master_sku,display_name)')
console.log('distinct combos', combos.length)
const EX = "(o.order_status LIKE '%ยกเลิก%' OR lower(o.order_status) LIKE '%cancel%' OR lower(o.order_status) LIKE '%return%')"
const J = 'FROM orders o JOIN cmap m ON m.variation_name IS o.variation_name AND m.master_sku IS o.master_sku AND m.display_name IS o.display_name'
const round2 = n => Math.round(n*100)/100
async function test(business, platform, month) {
  const t0 = performance.now()
  const where = ["o.date<>''"]; const p=[]
  if (business!=='all'){ where.push(business==='Payi' ? "o.business IN ('Payi','Payi Outlet')" : 'o.business=?'); if(business!=='Payi')p.push(business) }
  if (platform!=='all'){ where.push('o.platform=?'); p.push(platform) }
  const W = 'WHERE ' + where.join(' AND ')
  const agg = db.prepare(`SELECT o.ym ym, o.platform plat, o.variation_name var, m.rsku rsku, m.gkey gkey, m.glabel glabel, ${EX} ex, SUM(o.revenue) rev, SUM(o.qty) qty ${J} ${W} GROUP BY 1,2,3,4,5,6,7`).all(...p)
  const ords = db.prepare(`SELECT o.ym ym, m.gkey gkey, COUNT(DISTINCT o.order_id) n ${J} ${W} AND o.order_id<>'' GROUP BY 1,2`).all(...p)
  const ordsAll = db.prepare(`SELECT m.gkey gkey, COUNT(DISTINCT o.order_id) n ${J} ${W} AND o.order_id<>'' GROUP BY 1`).all(...p)
  const sqlMs = performance.now()-t0
  const months=[...new Set(agg.map(r=>r.ym))].sort(); const sel = month==='all'?null:(months.includes(month)?month:months.at(-1))
  const G = new Map(); const get=(k,l)=>{let g=G.get(k); if(!g)G.set(k,g={key:k,label:l,revenue:0,units:0,unitsFromSet:0,platforms:new Map(),skus:new Set()}); return g}
  for (const r of agg){ if(sel&&r.ym!==sel)continue; const g=get(r.gkey,r.glabel); if(r.ex)continue; g.revenue+=r.rev; g.units+=r.qty; if(r.plat)g.platforms.set(r.plat,(g.platforms.get(r.plat)||0)+r.rev); if(r.rev>0||r.qty>0)g.skus.add(r.rsku||'(ไม่ระบุ)')
    const rc=recipes.get(r.rsku+'|'+(r.var||'')); if(rc) for(const c of rc){const d=deriveGroup(nameBySku.get(c.c)||c.c,c.c,overrideMap); get(d.key,d.label).unitsFromSet+=r.qty*c.q} }
  const ordMap=new Map(); if(sel){for(const o of ords) if(o.ym===sel)ordMap.set(o.gkey,o.n)} else for(const o of ordsAll)ordMap.set(o.gkey,o.n)
  const api = await call({business,platform,month})
  let bad=0, checked=0
  for (const a of api.body.groups){ const g=G.get(a.key); checked++
    const exp={revenue:round2(g?.revenue||0),units:(g?.units||0)+(g?.unitsFromSet||0),directUnits:g?.units||0,unitsFromSet:g?.unitsFromSet||0,orders:ordMap.get(a.key)||0}
    for(const k in exp) if(Math.abs(exp[k]-a[k])>0.005){bad++;console.log('  DIFF',a.key,k,'api',a[k],'sql',exp[k])}
    for(const [pl,v] of Object.entries(a.platforms)) if(Math.abs(round2(g?.platforms.get(pl)||0)-v)>0.005){bad++;console.log('  PLAT DIFF',a.key,pl)} }
  const totRev=round2([...G.values()].reduce((s,g)=>s+(g.revenue>0||g.units+g.unitsFromSet>0?g.revenue:0),0))
  const skuN=new Set(); for(const g of G.values())for(const s of g.skus)skuN.add(s)
  if(Math.abs(totRev-api.body.totals.revenue)>0.5){bad++;console.log('  TOTAL REV DIFF',api.body.totals.revenue,totRev)}
  if(skuN.size!==api.body.totals.skuCount){bad++;console.log('  SKUCOUNT DIFF',api.body.totals.skuCount,skuN.size)}
  console.log(`${business}/${platform}/${month||'latest'} groupsChecked=${checked} apiGroups=${api.body.groups.length} totals.revenue=${api.body.totals.revenue} diffs=${bad} | api ${api.ms}ms, sql(local) ${Math.round(sqlMs)}ms`)
}
for (const [b,p,m] of [['all','all','all'],['all','all',''],['Payi','Shopee','all'],['all','TikTok Shop','']]) await test(b,p,m)
