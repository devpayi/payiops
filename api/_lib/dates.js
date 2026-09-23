// ย้ายตัวจริงไป shared/dates.js (2026-09-23) — Upload.jsx ต้องใช้ isoDate ด้วย แต่ตอน dev ทุก path /api/*
// ถูก middleware ใน vite.config.js ส่งไป API ฝั่ง server หมด client จึง import ไฟล์ใต้ api/ ไม่ได้
export { isoDate } from '../../shared/dates.js'
