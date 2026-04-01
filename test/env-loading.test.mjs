import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDir = mkdtempSync(join(tmpdir(), 'claude-agent-server-env-'))
const envPath = join(tempDir, '.env')

writeFileSync(
  envPath,
  [
    'ANTHROPIC_API_KEY=test-key-from-env-file',
    'ANTHROPIC_BASE_URL=https://proxy.example.test',
    'MODEL=claude-sonnet-test',
  ].join('\n'),
  'utf-8'
)

const originalApiKey = process.env.ANTHROPIC_API_KEY
const originalBaseUrl = process.env.ANTHROPIC_BASE_URL
const originalModel = process.env.MODEL

process.env.ANTHROPIC_API_KEY = 'existing-key'
delete process.env.ANTHROPIC_BASE_URL
delete process.env.MODEL

try {
  const { loadEnvFile } = await import('../dist/server/env.js')
  const loadedPath = loadEnvFile({ cwd: tempDir })

  assert.equal(loadedPath, envPath)
  assert.equal(process.env.ANTHROPIC_API_KEY, 'existing-key')
  assert.equal(process.env.ANTHROPIC_BASE_URL, 'https://proxy.example.test')
  assert.equal(process.env.MODEL, 'claude-sonnet-test')
} finally {
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalApiKey

  if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = originalBaseUrl

  if (originalModel === undefined) delete process.env.MODEL
  else process.env.MODEL = originalModel

  rmSync(tempDir, { recursive: true, force: true })
}

console.log('env-loading test passed')
