// Code-drawn companion to the dashboard mascot, with a pose for each channel.
export default function PricingHero({ pose='beam' }) {
  const flying=pose==='fly'
  const running=pose==='run'
  return <svg className="pricing-hero" viewBox="0 0 260 250" aria-hidden="true" focusable="false">
    <ellipse cx="130" cy="228" rx="71" ry="11" fill="#2f86cf" opacity=".12"/>
    <path d="m31 70 10-23 9 22 24 6-23 9-8 23-9-24-23-6Z" fill="#ffce1f" stroke="#16181d" strokeWidth="3"/>
    <path d="m220 160 6-14 7 14 15 5-15 5-7 14-6-14-15-5Z" fill="#ffce1f" stroke="#16181d" strokeWidth="3"/>
    <g transform={running?'rotate(-15 130 132)':flying?'rotate(17 130 132)':''} stroke="#16181d" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round">
      {running ? <><path d="m111 173-22 28 18 20m39-48 27 13 24-20" fill="none" strokeWidth="24"/><path d="m111 173-22 28 18 20m39-48 27 13 24-20" fill="none" stroke="#eef2f7" strokeWidth="16"/><path d="m100 216 10 9m80-53 12-8" stroke="#e5342b" strokeWidth="16"/></> : flying ? <><path d="M107 169 79 202 57 197" fill="none" strokeWidth="23"/><path d="m149 172 20 27 29-4" fill="none" strokeWidth="23"/><path d="m79 202-22-5m112 2 29-4" fill="none" stroke="#e5342b" strokeWidth="15"/></> : <><path d="m111 174-12 38-15 8" fill="none" strokeWidth="25"/><path d="m146 174 14 38 17 8" fill="none" strokeWidth="25"/><path d="m98 212-14 8m77-8 16 8" fill="none" stroke="#e5342b" strokeWidth="17"/></>}
      <path d="M99 107q29-15 58 0l5 57q-31 25-68 0Z" fill="#eef2f7"/>
      <path d="m99 114 29 21 29-21-4 28-25 14-30-17Z" fill="#e5342b"/>
      <path d="m99 160 29 12 28-12-2 17-26 11-28-11Z" fill="#e5342b"/>
      <circle cx="128" cy="130" r="9" fill="#59c8ff"/><circle cx="125" cy="127" r="2.5" fill="#fff" stroke="none"/>
      {running ? <><path d="m101 116-25 22-17-14m96-8 24-13 15 18" fill="none" strokeWidth="24"/><path d="m101 116-25 22-17-14m96-8 24-13 15 18" fill="none" stroke="#eef2f7" strokeWidth="16"/><circle cx="59" cy="124" r="8" fill="#e5342b"/><circle cx="194" cy="121" r="8" fill="#e5342b"/></> : flying ? <><path d="M101 116 70 96 52 65" fill="none" strokeWidth="23"/><path d="m154 116 29-26 7-34" fill="none" strokeWidth="23"/><path d="M101 116 70 96 52 65m102 51 29-26 7-34" fill="none" stroke="#e7edf4" strokeWidth="15"/><path d="m45 62-2-16m9 17 8-17m127 11-5-17m12 17 6-17" fill="none" strokeWidth="7"/></> : <><path d="m99 118 28 35 57-8" fill="none" strokeWidth="24"/><path d="m99 118 28 35 57-8" fill="none" stroke="#e7edf4" strokeWidth="16"/><path d="m156 116-13 29-2-37" fill="none" strokeWidth="23"/><path d="m156 116-13 29-2-37" fill="none" stroke="#eef2f7" strokeWidth="15"/></>}
      <path d="M80 55h-9v24h10m92-24h10v24h-10" fill="#b9c7d5"/>
      <path d="M128 21c-35 0-53 22-50 52 2 27 21 43 50 43s48-16 50-43c3-30-15-52-50-52Z" fill="#f4f7fa"/>
      <path d="m125 11-5 47 8 12 8-12-5-47Z" fill="#e5342b"/>
      <path d="M89 59q20-7 30 19-25 12-30-19Zm78 0q-20-7-30 19 25 12 30-19Z" fill="#ffda37"/>
      <path d="m116 95 12 5 12-5" fill="none" stroke="#6d7a89" strokeWidth="3"/>
      <path d="M87 40q12-12 24-12" fill="none" stroke="#fff" strokeWidth="7"/>
    </g>
    {!flying&&!running&&<g stroke="#16181d" strokeWidth="3"><path d="m188 132 28-20-5 20 30 3-27 13 9 18-35-10Z" fill="#ffce1f"/><path d="m194 142 43-4" stroke="#2f86cf" strokeWidth="7"/></g>}
    {(flying||running)&&<g stroke="#2f86cf" strokeWidth="4" strokeLinecap="round"><path d="m36 158-17 11m26 3-17 11m16 5-9 6"/></g>}
  </svg>
}
