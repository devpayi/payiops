// รวมค่าจังหวัดที่เขียนไม่เหมือนกันจากแต่ละแพลตฟอร์มให้เป็นชื่อเดียว
//   Shopee "จังหวัด"       -> "จังหวัดนนทบุรี" / "นนทบุรี" / "กรุงเทพฯ"
//   Lazada shippingAddress -> "กรุงเทพมหานคร/ Bangkok" (สองภาษา คั่นด้วย /)
//   TikTok "Province"      -> "Bangkok" / "Nonthaburi" (อังกฤษล้วนบางแถว)
//   zip fallback           -> ชื่อไทยมาตรฐาน 77 จังหวัด (ดู zipToProvince.js)
// ใช้ตอนอ่าน (demographic.js) — แก้ทั้งข้อมูลเก่าได้เลย ไม่ต้อง re-import

const CANONICAL = ["กระบี่","กรุงเทพมหานคร","กาญจนบุรี","กาฬสินธุ์","กำแพงเพชร","ขอนแก่น","จันทบุรี","ฉะเชิงเทรา","ชลบุรี","ชัยนาท","ชัยภูมิ","ชุมพร","ตรัง","ตราด","ตาก","นครนายก","นครปฐม","นครพนม","นครราชสีมา","นครศรีธรรมราช","นครสวรรค์","นนทบุรี","นราธิวาส","น่าน","บึงกาฬ","บุรีรัมย์","ปทุมธานี","ประจวบคีรีขันธ์","ปราจีนบุรี","ปัตตานี","พระนครศรีอยุธยา","พะเยา","พังงา","พัทลุง","พิจิตร","พิษณุโลก","ภูเก็ต","มหาสารคาม","มุกดาหาร","ยะลา","ยโสธร","ระนอง","ระยอง","ราชบุรี","ร้อยเอ็ด","ลพบุรี","ลำปาง","ลำพูน","ศรีสะเกษ","สกลนคร","สงขลา","สตูล","สมุทรปราการ","สมุทรสงคราม","สมุทรสาคร","สระบุรี","สระแก้ว","สิงห์บุรี","สุพรรณบุรี","สุราษฎร์ธานี","สุรินทร์","สุโขทัย","หนองคาย","หนองบัวลำภู","อำนาจเจริญ","อุดรธานี","อุตรดิตถ์","อุทัยธานี","อุบลราชธานี","อ่างทอง","เชียงราย","เชียงใหม่","เพชรบุรี","เพชรบูรณ์","เลย","แพร่","แม่ฮ่องสอน"]
const CANON_SET = new Set(CANONICAL)

// ชื่อไทยแบบเขียนอื่น -> มาตรฐาน
const TH_ALIAS = {
  'กรุงเทพ': 'กรุงเทพมหานคร', 'กรุงเทพฯ': 'กรุงเทพมหานคร', 'กทม': 'กรุงเทพมหานคร', 'กทม.': 'กรุงเทพมหานคร',
  'บางกอก': 'กรุงเทพมหานคร', 'พระนคร': 'กรุงเทพมหานคร',
  'อยุธยา': 'พระนครศรีอยุธยา', 'กรุงเก่า': 'พระนครศรีอยุธยา',
  'โคราช': 'นครราชสีมา', 'ศรีสะเกษ ': 'ศรีสะเกษ', 'สุราษฎร์': 'สุราษฎร์ธานี',
}

// ชื่ออังกฤษ (RTGS + ที่พบบ่อย) -> ไทย
const EN_ALIAS = {
  'bangkok': 'กรุงเทพมหานคร', 'krung thep': 'กรุงเทพมหานคร', 'krungthep': 'กรุงเทพมหานคร', 'bkk': 'กรุงเทพมหานคร',
  'nonthaburi': 'นนทบุรี', 'pathum thani': 'ปทุมธานี', 'pathumthani': 'ปทุมธานี',
  'samut prakan': 'สมุทรปราการ', 'samutprakan': 'สมุทรปราการ', 'samut sakhon': 'สมุทรสาคร', 'samut songkhram': 'สมุทรสงคราม',
  'chon buri': 'ชลบุรี', 'chonburi': 'ชลบุรี', 'rayong': 'ระยอง', 'chachoengsao': 'ฉะเชิงเทรา',
  'chiang mai': 'เชียงใหม่', 'chiangmai': 'เชียงใหม่', 'chiang rai': 'เชียงราย', 'chiangrai': 'เชียงราย',
  'lamphun': 'ลำพูน', 'lampang': 'ลำปาง', 'phayao': 'พะเยา', 'phrae': 'แพร่', 'nan': 'น่าน', 'mae hong son': 'แม่ฮ่องสอน',
  'nakhon ratchasima': 'นครราชสีมา', 'korat': 'นครราชสีมา', 'khon kaen': 'ขอนแก่น', 'khonkaen': 'ขอนแก่น',
  'udon thani': 'อุดรธานี', 'udonthani': 'อุดรธานี', 'ubon ratchathani': 'อุบลราชธานี', 'buri ram': 'บุรีรัมย์', 'buriram': 'บุรีรัมย์',
  'surin': 'สุรินทร์', 'sisaket': 'ศรีสะเกษ', 'si sa ket': 'ศรีสะเกษ', 'roi et': 'ร้อยเอ็ด', 'maha sarakham': 'มหาสารคาม',
  'kalasin': 'กาฬสินธุ์', 'sakon nakhon': 'สกลนคร', 'nakhon phanom': 'นครพนม', 'mukdahan': 'มุกดาหาร', 'loei': 'เลย',
  'nong khai': 'หนองคาย', 'nongkhai': 'หนองคาย', 'bueng kan': 'บึงกาฬ', 'nong bua lam phu': 'หนองบัวลำภู',
  'chaiyaphum': 'ชัยภูมิ', 'amnat charoen': 'อำนาจเจริญ', 'yasothon': 'ยโสธร',
  'nakhon pathom': 'นครปฐม', 'nakhonpathom': 'นครปฐม', 'ratchaburi': 'ราชบุรี', 'kanchanaburi': 'กาญจนบุรี',
  'phetchaburi': 'เพชรบุรี', 'prachuap khiri khan': 'ประจวบคีรีขันธ์', 'suphan buri': 'สุพรรณบุรี', 'suphanburi': 'สุพรรณบุรี',
  'ayutthaya': 'พระนครศรีอยุธยา', 'phra nakhon si ayutthaya': 'พระนครศรีอยุธยา', 'ang thong': 'อ่างทอง', 'sing buri': 'สิงห์บุรี',
  'lop buri': 'ลพบุรี', 'lopburi': 'ลพบุรี', 'saraburi': 'สระบุรี', 'chai nat': 'ชัยนาท', 'nakhon nayok': 'นครนายก',
  'nakhon sawan': 'นครสวรรค์', 'uthai thani': 'อุทัยธานี', 'kamphaeng phet': 'กำแพงเพชร', 'phichit': 'พิจิตร',
  'phitsanulok': 'พิษณุโลก', 'sukhothai': 'สุโขทัย', 'phetchabun': 'เพชรบูรณ์', 'tak': 'ตาก', 'uttaradit': 'อุตรดิตถ์',
  'prachin buri': 'ปราจีนบุรี', 'prachinburi': 'ปราจีนบุรี', 'sa kaeo': 'สระแก้ว', 'chanthaburi': 'จันทบุรี', 'trat': 'ตราด',
  'phuket': 'ภูเก็ต', 'krabi': 'กระบี่', 'phang nga': 'พังงา', 'phangnga': 'พังงา', 'ranong': 'ระนอง',
  'surat thani': 'สุราษฎร์ธานี', 'suratthani': 'สุราษฎร์ธานี', 'nakhon si thammarat': 'นครศรีธรรมราช', 'chumphon': 'ชุมพร',
  'songkhla': 'สงขลา', 'hat yai': 'สงขลา', 'trang': 'ตรัง', 'phatthalung': 'พัทลุง', 'satun': 'สตูล',
  'pattani': 'ปัตตานี', 'yala': 'ยะลา', 'narathiwat': 'นราธิวาส',
}

// "จังหวัด" / "จ." / "จ " / "อำเภอเมือง..." นำหน้า, "ฯ" ต่อท้าย, ช่องว่างซ้ำ
function stripThai(s) {
  return s
    .replace(/^จังหวัด\s*/, '')
    .replace(/^จ\.?\s*/, '')
    .replace(/ฯ$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// คืนชื่อจังหวัดมาตรฐาน — ถ้าจับคู่ไม่ได้ คืนค่าที่ทำความสะอาดแล้ว (ยังดีกว่าปล่อยดิบ)
export function normalizeProvince(raw) {
  let s = String(raw || '').trim()
  if (!s) return ''
  // สองภาษา "ไทย/ English" — เอาส่วนหน้า (ไทย)
  if (s.includes('/')) s = s.split('/')[0].trim()

  const thai = stripThai(s)
  if (CANON_SET.has(thai)) return thai
  if (TH_ALIAS[thai]) return TH_ALIAS[thai]

  const lower = s.toLowerCase().replace(/^(changwat|province of|จังหวัด)\s*/i, '').replace(/\s+/g, ' ').trim()
  if (EN_ALIAS[lower]) return EN_ALIAS[lower]
  const lowerNoSpace = lower.replace(/\s/g, '')
  for (const [k, v] of Object.entries(EN_ALIAS)) {
    if (k.replace(/\s/g, '') === lowerNoSpace) return v
  }

  // จับคู่ไม่ได้ — คืนไทยที่ strip แล้ว (หรือ raw ถ้า strip เกลี้ยง)
  return thai || s
}

export { CANONICAL, CANON_SET }
