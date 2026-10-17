// Read models only. No tax conversion, inferred channel totals, or mutations.
export function previousMarketingMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('เดือนไม่ถูกต้อง')
  const [year, value] = month.split('-').map(Number)
  return value===1 ? `${year-1}-12` : `${year}-${String(value-1).padStart(2,'0')}`
}

export function legacyTikTokSales(inputs, month, business) {
  const rows=inputs.filter(r=>r.month===month && r.business===business && r.platform==='TikTok Shop')
  const read=metric=>{
    const matches=rows.filter(r=>r.metric===metric)
    if(matches.length!==1) return {value:null,status:matches.length?'conflict':'absent'}
    const raw=matches[0].value
    const text=String(raw ?? '').trim()
    const valid=/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)
    const value=valid ? Number(text.replace(/,/g,'')) : NaN
    return Number.isFinite(value) && value>=0 ? {value,status:'present'} : {value:null,status:'invalid'}
  }
  return {month,business,basis:'legacy-unverified',gmv:read('tt_gmv'),
    channels:['affiliate','live','vdo','other'].map(metric=>({metric,...read(metric)}))}
}

export function marketingMonthChange(current, previous, currentMonth, previousMonth) {
  if(previousMonth!==previousMarketingMonth(currentMonth) || current?.status!=='present' || previous?.status!=='present' || previous.value===0) return null
  return (current.value-previous.value)/previous.value*100
}

export function legacyAdsTotals(inputs) {
  const totals={}
  for(const row of inputs) if(row.metric==='ads') totals[row.month]=(totals[row.month] || 0)+row.value
  return totals
}

// One identity for the local report store. Shopee keeps its original 3-part key so
// manifests written before the platform field existed still match.
export function reportScope(report) {
  const platform=report.platform || 'Shopee'
  return JSON.stringify(platform==='Shopee'?[report.business,report.shopId,report.month]:[platform,report.business,report.shopId,report.month])
}

export function selectMonthlyReport(reports,{month,business,shopId='',platform='Shopee'},candidate=null) {
  // Reports saved before the platform field existed are Shopee reports.
  const matches=r=>r && r.month===month && r.business===business && (r.platform || 'Shopee')===platform && (!shopId || r.shopId===shopId)
  return (matches(candidate)?candidate:null) || reports.find(matches) || null
}
