import { execFile } from 'child_process'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import { getAgentGatewayStateDir } from './config.js'

export type TranscriptionProvider = 'auto' | 'whisper' | 'parakeet' | 'openai'

export type TranscriptionResult = {
  text: string
  outputPath?: string
  provider?: Exclude<TranscriptionProvider, 'auto'>
}

export type TranscriptionConfig = {
  provider?: TranscriptionProvider
  /** Whisper model name (default: 'base'). Smaller models are faster but less accurate. */
  whisperModel?: string
  /** OpenAI transcription model. Used only when provider is explicitly 'openai'. */
  openAIModel?: string
  /** Timeout in ms for transcription (default: 120000) */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_WHISPER_MODEL = 'base'

function transcribeTempDir(): string {
  return join(getAgentGatewayStateDir(), 'transcriptions')
}

/**
 * Strip Whisper timestamp markers like [00:03.500 --> 00:05.200] from output.
 */
function stripTimestampMarkers(text: string): string {
  return text.replace(/\s*\[\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}\.\d{3}\]\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Transcribe an audio file using Whisper CLI (works on Windows).
 * Requires: `pip install openai-whisper` and ffmpeg in PATH.
 */
export async function transcribeWithWhisper(
  audioPath: string,
  config: TranscriptionConfig = {},
): Promise<TranscriptionResult> {
  const { whisperModel = DEFAULT_WHISPER_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS } = config
  const outDir = await mkdir(transcribeTempDir(), { recursive: true }).then(() => transcribeTempDir())
  const outputBase = basename(audioPath, extname(audioPath))
  const outputPath = join(outDir, `${outputBase}.txt`)

  await execFileAsync(
    'whisper',
    [
      audioPath,
      '--model', whisperModel,
      '--output_format', 'txt',
      '--output_dir', outDir,
    ],
    { timeout: timeoutMs },
  )

  try {
    const raw = await readFile(outputPath, 'utf8')
    const text = stripTimestampMarkers(raw)
    return { text, outputPath, provider: 'whisper' }
  } catch {
    return { text: '', outputPath, provider: 'whisper' }
  }
}

/**
 * Transcribe an audio file using Parakeet-MLX CLI (macOS only).
 * Requires: `parakeet-mlx` installed.
 */
export async function transcribeWithParakeet(
  audioPath: string,
  config: TranscriptionConfig = {},
): Promise<TranscriptionResult> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = config
  const outDir = await mkdir(transcribeTempDir(), { recursive: true }).then(() => transcribeTempDir())
  const outputBase = `transcript-${randomUUID().slice(0, 8)}`
  const outputPath = join(outDir, `${outputBase}.txt`)

  await execFileAsync(
    'parakeet-mlx',
    [
      audioPath,
      '--output-dir', outDir,
      '--output-format', 'txt',
      '--output-template', outputBase,
    ],
    { timeout: timeoutMs },
  )

  try {
    const text = await readFile(outputPath, 'utf8')
    return { text: text.trim(), outputPath, provider: 'parakeet' }
  } catch {
    return { text: '', outputPath, provider: 'parakeet' }
  }
}

/**
 * Detect which transcription tool is available on this system.
 * Returns 'whisper', 'parakeet', 'openai', or null.
 */
export async function detectTranscriptionTool(
  preferred: TranscriptionProvider = 'auto',
): Promise<'whisper' | 'parakeet' | 'openai' | null> {
  if (preferred === 'openai') {
    return process.env.OPENAI_API_KEY ? 'openai' : null
  }
  if (preferred === 'whisper') {
    return await isCommandAvailable('whisper') ? 'whisper' : null
  }
  if (preferred === 'parakeet') {
    return await isCommandAvailable('parakeet-mlx') ? 'parakeet' : null
  }

  const isWindows = process.platform === 'win32'

  if (isWindows) {
    return await isCommandAvailable('whisper') ? 'whisper' : null
  }

  // macOS / Linux
  if (await isCommandAvailable('parakeet-mlx')) return 'parakeet'
  if (process.platform !== 'darwin' && await isCommandAvailable('whisper')) {
    return 'whisper'
  }
  return null
}

/**
 * Transcribe audio using the best available tool for this platform.
 */
export async function transcribeAudio(
  audioPath: string,
  config: TranscriptionConfig = {},
): Promise<TranscriptionResult> {
  const tool = await detectTranscriptionTool(config.provider)
  if (!tool) {
    throw new Error(
      'No transcription tool available. Install whisper: pip install openai-whisper (ffmpeg also required). ' +
      'On macOS, parakeet-mlx is preferred. For external STT, set provider=openai and OPENAI_API_KEY.',
    )
  }
  if (tool === 'whisper') {
    return transcribeWithWhisper(audioPath, config)
  }
  if (tool === 'openai') {
    return transcribeWithOpenAI(audioPath, config)
  }
  return transcribeWithParakeet(audioPath, config)
}

export async function transcribeWithOpenAI(
  audioPath: string,
  config: TranscriptionConfig = {},
): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for OpenAI transcription')
  }

  const fileBytes = await readFile(audioPath)
  const body = new FormData()
  body.append('model', config.openAIModel || 'whisper-1')
  body.append(
    'file',
    new Blob([fileBytes]),
    basename(audioPath),
  )

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body,
    signal: AbortSignal.timeout(config.timeoutMs || DEFAULT_TIMEOUT_MS),
  })
  const data = await response.json() as { text?: string; error?: { message?: string } }
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI transcription failed: ${response.status}`)
  }

  const outDir = await mkdir(transcribeTempDir(), { recursive: true }).then(() => transcribeTempDir())
  const outputPath = join(outDir, `${basename(audioPath, extname(audioPath))}.openai.txt`)
  const text = String(data.text || '').trim()
  await writeFile(outputPath, text, 'utf8')
  return { text, outputPath, provider: 'openai' }
}

/**
 * Safely delete a file if it exists, ignoring errors.
 */
export async function safeUnlink(filePath: string | undefined): Promise<void> {
  if (!filePath) return
  try {
    await unlink(filePath)
  } catch {
    // ignore
  }
}

function execFileAsync(
  command: string,
  args: string[],
  options: { timeout: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: options.timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(error)
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['--help'], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}
