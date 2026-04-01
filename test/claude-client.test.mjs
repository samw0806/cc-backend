import assert from 'node:assert/strict'

const originalApiKey = process.env.ANTHROPIC_API_KEY
const originalBaseUrl = process.env.ANTHROPIC_BASE_URL

process.env.ANTHROPIC_API_KEY = 'test-key'
process.env.ANTHROPIC_BASE_URL = 'https://proxy.example.test'

try {
  const { createClaudeClient } = await import('../dist/services/claude.js')
  const client = createClaudeClient()

  assert.equal(client.apiKey, 'test-key')
  assert.equal(client.baseURL, 'https://proxy.example.test')
} finally {
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalApiKey

  if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = originalBaseUrl
}

console.log('claude-client test passed')
