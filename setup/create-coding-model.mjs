/**
 * Daily local MAX tag for OpenClaude.
 *
 *   node setup/create-coding-model.mjs
 *   → pulls official qwen3.8:27b if needed
 *   → creates/updates qwen3.8-oc-code:27b (160k, think on, GPU)
 *
 * Double-click: run.bat
 */
import { execFileSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modelfile = path.join(root, 'setup', 'Modelfile.qwen38-27b-oc-code')
const SOURCE = 'qwen3.8:27b'
const TAG = 'qwen3.8-oc-code:27b'

function ollamaList() {
  try {
    return execFileSync('ollama', ['list'], { encoding: 'utf8' })
  } catch {
    return ''
  }
}

const listed = ollamaList()
if (!listed.includes('qwen3.8:27b') && !/\bqwen3\.8\b/.test(listed)) {
  console.log('Pulling official Qwen3.8-27B weights (one-time, ~18 GB)...')
  console.log(SOURCE)
  execFileSync('ollama', ['pull', SOURCE], { stdio: 'inherit' })
} else {
  console.log('Source weights already installed')
}

console.log('Creating daily MAX tag', TAG)
console.log('Modelfile', modelfile)
execFileSync('ollama', ['create', TAG, '-f', modelfile], { stdio: 'inherit' })
console.log('OK', TAG)
console.log('Launcher: run.bat')
