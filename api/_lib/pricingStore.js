import { google } from 'googleapis'

let client
const TAB = 'pricing_scenario_revisions'
const HEADERS = ['request_id', 'payload_hash', 'scenario_id', 'revision_id', 'created_at', 'created_by', 'schema_version', 'engine_version', 'snapshot_json']

function sheets() {
  if (!client) client = google.sheets({ version: 'v4', auth: new google.auth.GoogleAuth({ credentials: {
    client_email: String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim().replace(/^["']|["']$/g, ''),
    private_key: String(process.env.GOOGLE_PRIVATE_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n'),
  }, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) })
  return client
}

export function pricingConfigured() {
  const id = process.env.PRICING_SHEET_ID?.trim()
  return Boolean(id && !['SHEET_ID', 'ARCHIVE_SHEET_ID', 'HR_SHEET_ID'].some(key => process.env[key]?.trim() === id))
}

export async function listPricingRevisions() {
  const spreadsheetId = process.env.PRICING_SHEET_ID.trim()
  const meta = await sheets().spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' })
  if (!meta.data.sheets?.some(s => s.properties.title === TAB)) return []
  const response = await sheets().spreadsheets.values.get({ spreadsheetId, range: `${TAB}!A:I` })
  return (response.data.values || []).slice(1).flatMap(row => {
    try { const snapshot = JSON.parse(row[8]); return [{ requestId: row[0], hash: row[1], scenarioId: row[2], revisionId: row[3], createdAt: row[4], createdBy: row[5], ...snapshot }] } catch { return [] }
  })
}

export async function appendPricingRevision(record) {
  const spreadsheetId = process.env.PRICING_SHEET_ID.trim()
  const meta = await sheets().spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' })
  if (!meta.data.sheets?.some(s => s.properties.title === TAB)) {
    try { await sheets().spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } }) } catch (error) { if (!/already exists/i.test(error.message || '')) throw error }
    await sheets().spreadsheets.values.update({ spreadsheetId, range: `${TAB}!A1:I1`, valueInputOption: 'RAW', requestBody: { values: [HEADERS] } })
  }
  const snapshot = JSON.stringify({ schemaVersion: record.schemaVersion, engineVersion: record.engineVersion, parentRevisionId: record.parentRevisionId, draft: record.draft, result: record.result })
  if (snapshot.length > 30000) throw new Error('แผนมีขนาดเกินที่บันทึกได้ กรุณาลดจำนวนส่วนประกอบ')
  // Deliberately no automatic append retry: a timeout may follow a successful write.
  await sheets().spreadsheets.values.append({ spreadsheetId, range: `${TAB}!A:I`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [[record.requestId, record.hash, record.scenarioId, record.revisionId, record.createdAt, record.createdBy, record.schemaVersion, record.engineVersion, snapshot]] } })
}
