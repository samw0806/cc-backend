import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const originalHome = process.env.HOME
const tempHome = mkdtempSync(join(tmpdir(), 'claude-agent-server-home-'))
const sessionId = `summary-test-${Date.now()}`
process.env.HOME = tempHome

const sessionDir = join(tempHome, '.claude-server', 'sessions')
const sessionFile = join(sessionDir, `${sessionId}.jsonl`)

if (!existsSync(sessionDir)) {
  mkdirSync(sessionDir, { recursive: true })
}

writeFileSync(
  sessionFile,
  [
    JSON.stringify({ role: 'user', content: 'Investigate the billing import failures for today.' }),
    JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'I will inspect the import logs.' }] }),
  ].join('\n') + '\n',
  'utf-8'
)

try {
  const { listPersistedSessionSummaries } = await import('../dist/services/sessionStorage.js')
  const summaries = listPersistedSessionSummaries()
  const summary = summaries.find((entry) => entry.session_id === sessionId)

  assert.ok(summary, 'expected summary for persisted session')
  assert.equal(summary.status, 'persisted')
  assert.equal(summary.message_count, 2)
  assert.match(summary.title, /Investigate the billing import failures/)
  assert.equal(typeof summary.last_active_at, 'number')
} finally {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome

  rmSync(sessionFile, { force: true })
  rmSync(tempHome, { recursive: true, force: true })
}

console.log('session-summaries test passed')
