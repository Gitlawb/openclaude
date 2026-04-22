/**
 * DuckHive mmx command — MiniMax CLI integration
 */
import { spawn } from 'child_process'
import { resolve } from 'path'

function findMmx(): string {
  const { existsSync } = require('fs')
  const locations = [
    resolve(process.env.HOME ?? '~', '.npm-global/bin/mmx'),
    '/usr/local/bin/mmx',
    '/usr/bin/mmx',
  ]
  for (const loc of locations) {
    if (existsSync(loc)) return loc
  }
  return 'mmx'
}

const MMX_BIN = findMmx()

export async function runMmxCommand(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const mmx = spawn(MMX_BIN, args, { stdio: 'inherit', shell: false })
    mmx.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`mmx exited with code ${code}`))
    })
    mmx.on('error', reject)
  })
}

export default {
  type: 'local' as const,
  name: 'mmx',
  description: 'MiniMax AI Platform — text, image, speech, music, video, vision, search',
  aliases: ['minimax'],
  supportsNonInteractive: true,
  load() {
    return import('./mmx-impl.js')
  },
}
