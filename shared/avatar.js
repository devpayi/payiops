// อวาตาร์ผู้ใช้ (emoji + สีพื้นหลัง) — ใช้ร่วมกันทั้ง api/auth.js (validate ค่าที่บันทึก) และ frontend
// (render picker + badge) กันสองฝั่งมีลิสต์ไม่ตรงกัน เหมือน shared/roles.js
export const AVATAR_EMOJIS = ['🐱', '🐶', '🦊', '🐼', '🐰', '🐻', '🐨', '🐯', '🐸', '🐵', '🦁', '🐷']

export const AVATAR_COLORS = {
  mint: { label: 'มิ้นท์', from: '#2dd4bf', to: '#0d9488' },
  sky: { label: 'ฟ้า', from: '#38bdf8', to: '#0284c7' },
  pink: { label: 'ชมพู', from: '#f9a8d4', to: '#db2777' },
  amber: { label: 'เหลือง', from: '#fcd34d', to: '#d97706' },
  violet: { label: 'ม่วง', from: '#c4b5fd', to: '#7c3aed' },
  orange: { label: 'ส้ม', from: '#fdba74', to: '#ea580c' },
}

export const AVATAR_COLOR_KEYS = Object.keys(AVATAR_COLORS)
export const avatarGradient = (color) => {
  const c = AVATAR_COLORS[color] || AVATAR_COLORS.mint
  return `linear-gradient(135deg, ${c.from} 0%, ${c.to} 100%)`
}
