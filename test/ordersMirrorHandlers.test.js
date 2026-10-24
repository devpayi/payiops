import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

test('handlers จริง: import_log มาก่อน mirror ทั้ง POST/DELETE/TikTok ingest', () => {
  // module mocks ต้องใช้ flag; แยก process เพื่อไม่เปลี่ยน npm test/runtime ของ production
  const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--test',
    fileURLToPath(new URL('./fixtures/ordersMirrorHandlers.mjs', import.meta.url))], {
    encoding: 'utf8', timeout: 20000,
  })
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}\n${child.error || ''}`)
})
