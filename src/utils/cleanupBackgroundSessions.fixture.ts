import { cleanupOldMessageFilesInBackground } from './cleanup.js'

try {
  await cleanupOldMessageFilesInBackground()
  process.stdout.write(`${JSON.stringify({ completed: true })}\n`)
} catch {
  process.stderr.write('background cleanup fixture failed\n')
  process.exitCode = 1
}
