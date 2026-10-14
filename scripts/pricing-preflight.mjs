// Read-only release gate. Run with the target environment, never print secrets.
// node --env-file=.env scripts/pricing-preflight.mjs [--online]
import { google } from 'googleapis'
import { pricingConfigured } from '../api/_lib/pricingStore.js'
import { pricingAccounts } from '../api/_lib/pricing.js'

let failures = 0
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'BLOCK'} ${label}`); if (!ok) failures++ }
check('AUTH_SECRET configured (at least 32 characters)', (process.env.AUTH_SECRET || '').length >= 32)
check('Private pricing sheet differs from Ops / archive / HR', pricingConfigured())
check('Owner review account allowlist is exactly dev', process.env.PRICING_ALLOWED_USERS?.trim() === 'dev' && pricingAccounts().join(',') === 'dev')
for (const key of ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'SHEET_ID']) check(`${key} configured`, Boolean(process.env[key]?.trim()))

if (process.argv.includes('--online') && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.SHEET_ID) {
  const auth = new google.auth.GoogleAuth({ credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL.trim().replace(/^["']|["']$/g, ''),
    private_key: process.env.GOOGLE_PRIVATE_KEY.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n'),
  }, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.metadata.readonly'] })
  const sheets = google.sheets({ version: 'v4', auth })
  const drive = google.drive({ version: 'v3', auth })
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID, range: 'users!A:Z' })
    const [headers = [], ...rows] = response.data.values || []
    const column = headers.findIndex(v => /^(username|user)$/i.test(String(v)))
    check('Users schema has username', column >= 0)
    const names = new Set(rows.map(row => String(row[column] || '').trim().toLowerCase()))
    for (const name of pricingAccounts()) check(`Account ${name} exists`, names.has(name))
  } catch { check('Ops users readable with service account', false) }
  if (pricingConfigured()) {
    try {
      const { data } = await drive.files.get({ fileId: process.env.PRICING_SHEET_ID.trim(), fields: 'mimeType,capabilities(canEdit),permissions(type,role,emailAddress,deleted)' })
      check('Private store is a native Google Sheet', data.mimeType === 'application/vnd.google-apps.spreadsheet')
      check('Service account can edit private store', data.capabilities?.canEdit === true)
      // Fail closed if permissions cannot be inspected. Only owner + service account
      // may directly access the database; app users read through the guarded API.
      check('Private store permissions visible and restricted', Array.isArray(data.permissions) && data.permissions.length > 0 && data.permissions.every(p => p.deleted || (p.type === 'user' && (p.role === 'owner' || p.emailAddress === process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL.trim()))))
      await sheets.spreadsheets.get({ spreadsheetId: process.env.PRICING_SHEET_ID.trim(), fields: 'sheets.properties.title' })
      check('Private store readable', true)
    } catch { check('Private store and permissions readable', false) }
  }
}
console.log(failures ? `NOT READY: ${failures} blocking checks` : 'READY: configuration checks passed; run authenticated smoke test before production')
process.exitCode = failures ? 1 : 0
