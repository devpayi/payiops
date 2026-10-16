import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { pathToFileURL } from 'node:url'

// เสิร์ฟ api/*.js (Vercel-style functions) บน dev server ในเครื่อง
// จะได้ทดสอบ /api/summary ฯลฯ ด้วย `npm run dev` โดยไม่ต้องใช้ `vercel dev`
// หมายเหตุ: แก้ไฟล์ใน api/ แล้วต้อง restart dev server
function localApi() {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next()
        const name = req.url.split('?')[0].replace('/api/', '')
        if (!/^[\w-]+$/.test(name)) { res.statusCode = 404; return res.end('{"error":"not found"}') }

        let mod
        try {
          mod = await import(pathToFileURL(path.resolve(process.cwd(), 'api', `${name}.js`)).href)
        } catch {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          return res.end('{"error":"not found"}')
        }

        // แปลง req/res ของ node ให้เข้ากับรูปแบบ handler ของ Vercel
        const url = new URL(req.url, 'http://localhost')
        req.query = Object.fromEntries(url.searchParams)
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
          const chunks = []
          for await (const c of req) chunks.push(c)
          req.rawBody = Buffer.concat(chunks).toString()
          try { req.body = JSON.parse(req.rawBody || '{}') } catch { req.body = {} }
        }
        res.status = (code) => { res.statusCode = code; return res }
        res.json = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }

        try { await mod.default(req, res) } catch (e) { res.status(500).json({ error: e.message }) }
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // โหลด .env ทุกตัว (รวม GOOGLE_*) เข้า process.env ให้ api/ ใช้ตอน dev
  const env = loadEnv(mode, process.cwd(), '')
  for (const [k, v] of Object.entries(env)) {
    if (!(k in process.env)) process.env[k] = v
  }
  return {
    plugins: [
      react(),
      tailwindcss(), // 💡 ปลั๊กอินตรงตัวของ Tailwind v4 ตัวเดียวจบ ไม่ต้องตั้งค่า PostCSS อีกต่อไป
      localApi(),
    ],
    // ให้ dev server ผูกกับ PORT ที่ environment กำหนด (เช่น preview harness) ถ้ามี
    server: {
      ...(process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {}),
      // Private review reports are read through the authenticated API only.
      fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/reports/**'] },
    },
  }
})
