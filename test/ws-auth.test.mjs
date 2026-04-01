import assert from 'node:assert/strict'

const { isUpgradeRequestAuthorized } = await import('../dist/server/auth.js')

assert.equal(isUpgradeRequestAuthorized(undefined, undefined, undefined), true)
assert.equal(isUpgradeRequestAuthorized('Bearer secret-token', undefined, 'secret-token'), true)
assert.equal(isUpgradeRequestAuthorized(undefined, 'secret-token', 'secret-token'), true)
assert.equal(isUpgradeRequestAuthorized('Bearer wrong-token', undefined, 'secret-token'), false)
assert.equal(isUpgradeRequestAuthorized(undefined, 'wrong-token', 'secret-token'), false)
assert.equal(isUpgradeRequestAuthorized(undefined, undefined, 'secret-token'), false)

console.log('ws-auth test passed')
