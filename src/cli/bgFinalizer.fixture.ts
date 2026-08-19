import { writeFile } from 'node:fs/promises'
import { handleBgFlag } from './bg.js'
import { prepareBackgroundSessionFinalizer } from './bgFinalizer.js'
import { noteBackgroundSessionTerminationSignal } from '../utils/backgroundSessionTermination.js'

const invocation = process.argv.slice(2)
if (invocation[0] === 'launcher') {
  await handleBgFlag(['--bg', invocation[1] ?? 'success'])
} else {
  const mode = invocation.at(-1)
  await prepareBackgroundSessionFinalizer()

  if (mode === 'throw') {
    throw new Error('intentional background finalizer fixture failure')
  }
  if (mode === 'fail') {
    process.exitCode = 23
  }
  if (mode === 'sigint') {
    process.once('SIGINT', () => {
      noteBackgroundSessionTerminationSignal('SIGINT')
      process.exit(0)
    })
  }
  if (mode === 'sigterm') {
    process.once('SIGTERM', () => {
      noteBackgroundSessionTerminationSignal('SIGTERM')
      process.exit(143)
    })
  }
  const readyPath = process.env.OPENCLAUDE_BG_FINALIZER_FIXTURE_READY
  if (readyPath) await writeFile(readyPath, 'ready')
  if (mode === 'wait' || mode === 'sigint' || mode === 'sigterm') {
    setInterval(() => {}, 1_000)
  }
}
