/**
 * Pin OpenClaude + profiles to 160k context (matches run.bat / Modelfile).
 * Fixes exceed_context_size_error when OLLAMA_CONTEXT_LENGTH was stuck at 65536.
 */
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const CTX = '163840'
const FALLBACK = '153600'
const COMPACT = '143360'
const MODEL = 'qwen3.8-oc-code:27b'
const user = process.env.USERPROFILE

const files = [
  path.join(user, '.openclaude', 'settings.json'),
  path.join(user, '.openclaude-profiles', 'software-ai', 'settings.json'),
  path.join(user, '.openclaude-profiles', 'coder', 'settings.json'),
  path.join(user, '.openclaude-profiles', 'websites', 'settings.json'),
  path.join(user, '.openclaude-profiles', 'goldenboy', 'settings.json'),
]

for (const f of files) {
  if (!fs.existsSync(f)) continue
  const s = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))
  if (!s.env || typeof s.env !== 'object') s.env = {}
  s.env.OLLAMA_CONTEXT_LENGTH = CTX
  s.env.CLAUDE_CODE_OPENAI_FALLBACK_CONTEXT_WINDOW = FALLBACK
  s.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = COMPACT
  if (typeof s.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS === 'string') {
    try {
      const m = JSON.parse(s.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS)
      m[MODEL] = 163840
      m['qwen3.8:27b'] = 163840
      m['qwen3.8:27b-mtp-q8_0'] = 163840
      m['qwen3.8:27b-q8_0'] = 163840
      m['qwen3.6-oc:27b'] = 163840
      s.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS = JSON.stringify(m)
    } catch {
      /* keep */
    }
  }
  if (!s.model || String(s.model).includes('480b-cloud')) s.model = MODEL
  if (s.env.OPENAI_MODEL) s.env.OPENAI_MODEL = s.model
  fs.writeFileSync(f, JSON.stringify(s, null, 4) + '\n', 'utf8')
  console.log('OK', f)
  console.log('  model=', s.model, 'OLLAMA_CONTEXT_LENGTH=', s.env.OLLAMA_CONTEXT_LENGTH)
}

execFileSync(
  'powershell',
  [
    '-NoProfile',
    '-Command',
    "[Environment]::SetEnvironmentVariable('OLLAMA_CONTEXT_LENGTH', '163840', 'User')",
  ],
  { stdio: 'inherit' },
)
console.log('OK user env OLLAMA_CONTEXT_LENGTH=163840')
console.log('Next: close OpenClaude, run: ollama stop qwen3.8-oc-code:27b')
console.log('Then start with run.bat and type /clear in the new chat.')
