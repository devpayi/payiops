// มาสคอตวาดเองสไตล์ป็อปอาร์ต เส้นดำหนา ตาเหลือง แถบแดง (ออริจินัล ไม่ใช่ IP ใคร)
// ใช้ในหน้า Dashboard สไตล์ .daily-glass-page (ภาพรวม / รายวัน / รายเดือน)
export default function Mascot({ pose = 'wave', size = 66, style }) {
  const arms = {
    wave: <>
      <line x1="33" y1="76" x2="20" y2="92" stroke="#16181d" strokeWidth="10" strokeLinecap="round" />
      <line x1="67" y1="74" x2="82" y2="52" stroke="#16181d" strokeWidth="10" strokeLinecap="round" />
    </>,
    run: <>
      <line x1="34" y1="74" x2="18" y2="66" stroke="#16181d" strokeWidth="10" strokeLinecap="round" />
      <line x1="66" y1="76" x2="82" y2="86" stroke="#16181d" strokeWidth="10" strokeLinecap="round" />
    </>,
    cheer: <>
      <line x1="33" y1="74" x2="18" y2="54" stroke="#16181d" strokeWidth="10" strokeLinecap="round" />
      <line x1="67" y1="74" x2="82" y2="54" stroke="#16181d" strokeWidth="10" strokeLinecap="round" />
    </>,
    think: <>
      <line x1="34" y1="76" x2="24" y2="90" stroke="#16181d" strokeWidth="10" strokeLinecap="round" />
      <line x1="66" y1="74" x2="58" y2="58" stroke="#16181d" strokeWidth="10" strokeLinecap="round" />
    </>,
  }
  const legs = pose === 'run'
    ? <><line x1="43" y1="99" x2="34" y2="114" stroke="#16181d" strokeWidth="10" strokeLinecap="round" /><line x1="57" y1="99" x2="66" y2="108" stroke="#16181d" strokeWidth="10" strokeLinecap="round" /></>
    : <><line x1="43" y1="99" x2="41" y2="114" stroke="#16181d" strokeWidth="10" strokeLinecap="round" /><line x1="57" y1="99" x2="59" y2="114" stroke="#16181d" strokeWidth="10" strokeLinecap="round" /></>
  return (
    <svg width={size} height={size * 1.16} viewBox="0 0 100 116" style={style} aria-hidden="true">
      <g transform={pose === 'run' ? 'rotate(-12 50 60)' : ''}>
        {arms[pose] || arms.wave}
        {legs}
        <rect x="40" y="93" width="20" height="11" rx="3" fill="#e5342b" />
        <path d="M33 70 Q50 63 67 70 L65 97 Q50 103 35 97 Z" fill="#fff" stroke="#16181d" strokeWidth="4" />
        <path d="M35 78 Q50 73 65 78 L64 89 Q50 94 36 89 Z" fill="#e5342b" />
        <rect x="15" y="33" width="9" height="13" rx="3" fill="#fff" stroke="#16181d" strokeWidth="3" />
        <rect x="76" y="33" width="9" height="13" rx="3" fill="#fff" stroke="#16181d" strokeWidth="3" />
        <ellipse cx="50" cy="40" rx="30" ry="31" fill="#fff" stroke="#16181d" strokeWidth="4" />
        <rect x="46" y="1" width="8" height="20" rx="4" fill="#16181d" />
        <ellipse cx="39" cy="41" rx="8.5" ry="12" fill="#ffce1f" stroke="#16181d" strokeWidth="3" />
        <ellipse cx="61" cy="41" rx="8.5" ry="12" fill="#ffce1f" stroke="#16181d" strokeWidth="3" />
      </g>
    </svg>
  )
}
