/**
 * Quick test of Qwen OAuth device code flow.
 * Run: node --import tsx src/services/api/qwenOAuth.ts
 * Or: npx tsx src/services/api/qwenOAuth.test.ts
 */

import { authenticateWithQwenOAuth } from './qwenOAuth.js'

console.log('Starting Qwen OAuth test...')

authenticateWithQwenOAuth((progress) => {
  console.log(`[${progress.status}] ${progress.message}`)
  if (progress.userCode) {
    console.log(`User code: ${progress.userCode}`)
  }
  if (progress.verificationUrl) {
    console.log(`URL: ${progress.verificationUrl}`)
  }
})
.then((creds) => {
  console.log('SUCCESS! Credentials obtained:')
  console.log(`  access_token: ${creds.access_token.substring(0, 20)}...`)
  console.log(`  resource_url: ${creds.resource_url}`)
  console.log(`  expires: ${creds.expiry_date ? new Date(creds.expiry_date).toISOString() : 'unknown'}`)
})
.catch((err) => {
  console.error('FAILED:', err.message)
  process.exit(1)
})
