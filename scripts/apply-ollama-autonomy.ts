/**
 * Apply Ollama-first autonomy policy to ~/.claude/settings.json
 * and refresh .openclaude-profile.json in the project root.
 *
 * Usage: bun run scripts/apply-ollama-autonomy.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OLLAMA = {
  base_url: 'http://localhost:11434/v1',
  api_key: 'ollama',
} as const

const FLEET = [
  'qwen2.5:7b',
  'qwen2.5:14b',
  'qwen3-vl:235b-cloud',
  'glm-5.1:cloud',
  'kimi-k2.6:cloud',
  'minimax-m3:cloud',
  'glm-4.6:cloud', // alias
] as const

function main(): void {
  const settingsPath = join(homedir(), '.claude', 'settings.json')
  if (!existsSync(settingsPath)) {
    console.error(`Missing ${settingsPath}`)
    process.exit(1)
  }

  const raw = readFileSync(settingsPath, 'utf8')
  const settings = JSON.parse(raw) as Record<string, unknown>

  const agentModels: Record<string, typeof OLLAMA> = {}
  for (const name of FLEET) {
    agentModels[name] = { ...OLLAMA }
  }

  settings.autonomy = {
    enabled: true,
    mode: 'smart',
    classifier: 'heuristic',
    circuitBreakers: true,
    telemetry: true,
    autoApplyPolicy: false,
    // Phase 5: protect local-model context from huge Bash/Grep dumps
    maskToolResults: true,
    maxToolResultChars: 20_000,
    maxToolResultsPerMessageChars: 80_000,
  }
  settings.agentModels = agentModels
  settings.agentRouting = {
    Explore: 'qwen2.5:14b',
    Plan: 'glm-5.1:cloud',
    'general-purpose': 'qwen3-vl:235b-cloud',
    default: 'qwen2.5:14b',
  }
  settings.taskRouting = {
    trivial: 'qwen2.5:7b',
    standard: 'qwen2.5:14b',
    hard: 'qwen3-vl:235b-cloud',
    vision: 'qwen3-vl:235b-cloud',
  }
  settings.fallbackChains = {
    trivial: ['qwen2.5:7b', 'qwen2.5:14b', 'minimax-m3:cloud'],
    standard: ['qwen2.5:14b', 'qwen2.5:7b', 'glm-5.1:cloud', 'kimi-k2.6:cloud'],
    hard: [
      'qwen3-vl:235b-cloud',
      'glm-5.1:cloud',
      'kimi-k2.6:cloud',
      'minimax-m3:cloud',
      'qwen2.5:14b',
    ],
    vision: ['qwen3-vl:235b-cloud', 'glm-5.1:cloud', 'qwen2.5:14b'],
    default: [
      'qwen2.5:14b',
      'qwen3-vl:235b-cloud',
      'glm-5.1:cloud',
      'qwen2.5:7b',
    ],
  }
  if (settings.effortLevel === 'xhigh') {
    settings.effortLevel = 'high'
  }

  const bak = `${settingsPath}.bak-ollama-${Date.now()}`
  writeFileSync(bak, raw, 'utf8')
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')

  const profilePath = join(process.cwd(), '.openclaude-profile.json')
  writeFileSync(
    profilePath,
    JSON.stringify(
      {
        profile: 'ollama',
        env: {
          CLAUDE_CODE_USE_OPENAI: '1',
          OPENAI_BASE_URL: 'http://localhost:11434/v1',
          OPENAI_API_KEY: 'ollama',
          OPENAI_MODEL: 'qwen2.5:14b',
          OPENCLAUDE_AUTONOMY: '1',
          OPENCLAUDE_AUTONOMY_MODE: 'smart',
        },
        createdAt: new Date().toISOString(),
        notes:
          'Ollama-first fleet: local 7b/14b + cloud hard/vision via autonomy',
      },
      null,
      2,
    ),
    'utf8',
  )

  console.log('Ollama autonomy policy applied.')
  console.log(`  settings: ${settingsPath}`)
  console.log(`  backup:   ${bak}`)
  console.log(`  profile:  ${profilePath}`)
  console.log('')
  console.log('Fleet:', FLEET.filter(m => m !== 'glm-4.6:cloud').join(', '))
  console.log('')
  console.log('Launch:')
  console.log('  .\\start-ollama.ps1')
  console.log('  # or: .\\start-ollama.ps1 -Mode smart -AutonomyMode smart')
  console.log('  # inside app: /route')
}

main()
