/**
 * DuckHive mmx CLI subcommand — MiniMax AI Platform
 *
 * Registers `duckhive mmx` subcommand group:
 *   duckhive mmx text chat --message "Hello"
 *   duckhive mmx image "A cyberpunk cat"
 *   duckhive mmx speech synthesize --text "Hello" --out hello.mp3
 *   duckhive mmx music generate --prompt "Upbeat electronic" --out track.mp3
 *   duckhive mmx video generate --prompt "Ocean waves"
 *   duckhive mmx vision ./photo.jpg
 *   duckhive mmx search "latest AI news"
 *   duckhive mmx quota
 *
 * This proxies directly to the mmx CLI binary.
 */
import { type Command } from '@commander-js/extra-typings'
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

export function registerDuckhiveMmxCommand(program: Command): void {
  const mmx = program
    .command('mmx')
    .description('MiniMax AI Platform — text, image, speech, music, video, vision, search')
    .configureHelp({ sortSubcommands: true, sortOptions: true })
    .allowUnknownOption(false)

  // Pass all args to mmx CLI
  mmx.action(async () => {
    const args = process.argv.slice(process.argv.indexOf('mmx') + 1)
    if (args.length === 0) {
      console.log(`🦆 DuckHive MiniMax Integration

Usage: duckhive mmx <resource> <command> [flags]

Resources:
  auth       Authentication (login, status, refresh, logout)
  text       Text generation (chat)
  speech     Speech synthesis (synthesize, voices)
  image      Image generation (generate)
  video      Video generation (generate, task, download)
  music      Music generation (generate, cover)
  search     Web search (query)
  vision     Image understanding (describe)
  quota      Usage quotas (show)

Examples:
  duckhive mmx text chat --message "Hello"
  duckhive mmx image "A cyberpunk cat with neon wings"
  duckhive mmx speech synthesize --text "Welcome" --out hello.mp3
  duckhive mmx music generate --prompt "Upbeat electronic" --out track.mp3
  duckhive mmx video generate --prompt "Ocean waves at sunset"
  duckhive mmx vision ./photo.jpg
  duckhive mmx search "latest AI news"
  duckhive mmx quota
`)
      process.exit(0)
    }

    return new Promise((resolve, reject) => {
      // Add --non-interactive to prevent mmx from hanging on stdin
      const mmxArgs = ['--non-interactive', ...args]
      const child = spawn(MMX_BIN, mmxArgs, {
        stdio: 'inherit',
        shell: false,
      })
      child.on('exit', (code) => {
        process.exit(code ?? 0)
      })
      child.on('error', (err) => {
        console.error(`Error: mmx not found. Install with: npm install -g mmx-cli`)
        reject(err)
      })
    })
  })
}
