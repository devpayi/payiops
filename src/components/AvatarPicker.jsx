import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { AVATAR_EMOJIS, AVATAR_COLORS, AVATAR_COLOR_KEYS, avatarGradient } from '../../shared/avatar.js'

// ย้ายมาจาก Settings.jsx ไปหน้า Home ตามที่ owner ขอ (2026-07-31) — เหตุผล: ทุกคนเห็นหน้า Home
// เป็นค่าเริ่มต้นหลัง login แต่ไม่ใช่ทุกคนเข้า Settings เลยทำให้ฟีเจอร์นี้ discover ยากถ้าซ่อนอยู่ที่นั่น
export default function AvatarPicker({ me, compact = false }) {
  const [emoji, setEmoji] = useState(me?.avatar_emoji || AVATAR_EMOJIS[0])
  const [color, setColor] = useState(me?.avatar_color || AVATAR_COLOR_KEYS[0])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const savedRef = { emoji: me?.avatar_emoji || AVATAR_EMOJIS[0], color: me?.avatar_color || AVATAR_COLOR_KEYS[0] }
  const isDirty = emoji !== savedRef.emoji || color !== savedRef.color

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-avatar', emoji, color }),
      })
      const d = await res.json()
      if (!d.success) throw new Error(d.error || 'บันทึกไม่สำเร็จ')
      const nextMe = { ...(me || {}), avatar_emoji: emoji, avatar_color: color }
      localStorage.setItem('payi-user', JSON.stringify(nextMe))
      // reload ให้แน่ใจว่า badge มุมขวาบน + hero การ์ดด้านบน (อ่าน localStorage ตอน render ของ App.jsx)
      // อัปเดตตาม — คนละ component กัน ไม่มี state กลางให้ sync สดระหว่างที่ยังอยู่หน้าเดิม
      window.location.reload()
    } catch (err) {
      setMsg({ ok: false, text: err.message })
      setBusy(false)
    }
  }

  const tileSize = compact ? 34 : 46
  const glassTile = (active) => ({
    width: tileSize, height: tileSize, borderRadius: compact ? 12 : 16, display: 'grid', placeItems: 'center', cursor: 'pointer',
    fontSize: compact ? 16 : 22, border: active ? '2px solid var(--payi-mint-strong)' : '1px solid rgba(255,255,255,0.5)',
    background: active ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)',
    backdropFilter: 'blur(10px)', boxShadow: active ? '0 6px 16px rgba(37,99,235,0.22)' : '0 4px 10px rgba(16,24,40,0.06)',
    transition: 'transform 0.12s, box-shadow 0.12s', transform: active ? 'scale(1.06)' : 'scale(1)',
  })

  return (
    <div style={{
      borderRadius: compact ? 16 : 20, padding: compact ? '14px 16px' : '20px 22px', marginBottom: compact ? 0 : 24,
      background: 'var(--payi-surface)', border: '1px solid var(--payi-border)',
      boxShadow: '0 6px 16px rgba(15,23,42,0.04)', display: 'grid', gap: compact ? 10 : 14,
    }}>
      <div style={{ fontSize: compact ? 12 : 13, fontWeight: 800, color: 'var(--payi-text-strong)' }}>อวาตาร์ของฉัน</div>
      {msg && (
        <div style={{ fontSize: 12, padding: '8px 10px', borderRadius: 8, color: 'var(--payi-danger)', background: 'var(--payi-danger-bg)' }}>
          {msg.text}
        </div>
      )}
      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 18, display: 'grid', placeItems: 'center', fontSize: 26,
            background: avatarGradient(color), boxShadow: '0 10px 22px rgba(16,24,40,0.14)', flexShrink: 0,
          }}>
            {emoji}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--payi-text-muted)' }}>เห็นตรงมุมขวาบนกับ sidebar</div>
        </div>
      )}

      <div>
        {!compact && <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--payi-text-muted)', marginBottom: 8 }}>เลือกตัวการ์ตูน</div>}
        <div style={{ display: 'flex', gap: compact ? 6 : 8, flexWrap: 'wrap' }}>
          {AVATAR_EMOJIS.map((e) => (
            <div key={e} role="button" onClick={() => setEmoji(e)} style={glassTile(emoji === e)}>{e}</div>
          ))}
        </div>
      </div>

      <div>
        {!compact && <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--payi-text-muted)', marginBottom: 8 }}>เลือกสี</div>}
        <div style={{ display: 'flex', gap: compact ? 6 : 8, flexWrap: 'wrap' }}>
          {AVATAR_COLOR_KEYS.map((c) => (
            <div
              key={c} role="button" onClick={() => setColor(c)} title={AVATAR_COLORS[c].label}
              style={{ ...glassTile(color === c), background: avatarGradient(c), color: '#fff' }}
            >
              {color === c ? '✓' : ''}
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={save}
        disabled={busy || !isDirty}
        style={{
          padding: compact ? '7px 14px' : '9px 16px', width: 'fit-content', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: 'var(--payi-gradient-primary)', color: '#fff', fontSize: compact ? 12 : 13, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 6, opacity: busy || !isDirty ? 0.5 : 1,
        }}
      >
        {busy ? <Loader2 size={13} className="payi-spin" /> : 'บันทึก'}
      </button>
    </div>
  )
}
