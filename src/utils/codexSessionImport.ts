import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, open as fsOpen, readdir, readFile, stat, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { LogOption } from '../types/logs.js'
import { getProjectDir } from './sessionStoragePortable.js'

/**
 * Import de sessões do Codex CLI (~/.codex/sessions) para o formato de
 * transcript do Verboo, habilitando /resume cross-CLI.
 *
 * O rollout do Codex é append-only com eventos de tipos distintos
 * (session_meta, response_item, event_msg, token_usage_record, world_state,
 * turn_context, compacted). A conversão mapeia:
 *
 *   response_item message (role=user)            → user message (texto)
 *   response_item message (role=assistant)       → assistant message (texto)
 *   response_item custom_tool_call/function_call → assistant tool_use
 *   response_item *_output                       → user tool_result
 *   compacted                                    → descarta o histórico anterior
 *                                                  e recomeça de
 *                                                  replacement_history (mesma
 *                                                  semântica do Codex: a cauda
 *                                                  do arquivo é o contexto atual)
 *   reasoning / event_msg / token_usage_record /
 *   world_state / turn_context                    → descartados
 *
 * Claude Code já é interop por design (getProjectsDir aponta para
 * ~/.claude/projects), então apenas o Codex precisa de conversão.
 *
 * Override do diretório de origem via VERBOO_CODEX_SESSIONS_DIR (testes).
 */

export type CodexRolloutInfo = {
  path: string
  sessionId: string
  cwd: string
  startedAt: Date
  modified: Date
  size: number
}

// Mensagens sintéticas/instrução do Codex que não são prompts do usuário.
const CODEX_WRAPPER_PREFIXES = [
  '<environment_context>',
  '<user_instructions>',
  '<skills_instructions>',
  '<turn_aborted>',
]

const FIRST_LINE_READ_BYTES = 8192
const FIRST_PROMPT_MAX_BYTES = 512 * 1024
const FIRST_PROMPT_CHUNK_BYTES = 64 * 1024

export function getCodexSessionsDir(): string {
  return (
    process.env.VERBOO_CODEX_SESSIONS_DIR ??
    join(homedir(), '.codex', 'sessions')
  )
}

/**
 * Nomes de sessão do Codex (~/.codex/session_index.jsonl, campo thread_name).
 * São os títulos que o `codex resume` mostra — muito mais legíveis que o
 * primeiro prompt. Deriva o caminho do pai do diretório de sessões para
 * respeitar VERBOO_CODEX_SESSIONS_DIR em testes.
 */
export async function readCodexSessionNames(): Promise<Map<string, string>> {
  const indexPath = join(dirname(getCodexSessionsDir()), 'session_index.jsonl')
  const names = new Map<string, string>()
  try {
    const content = await readFile(indexPath, 'utf8')
    for (const line of content.split('\n')) {
      const parsed = parseJsonLine(line)
      const id = parsed?.id
      const name = parsed?.thread_name
      if (typeof id === 'string' && typeof name === 'string' && name) {
        names.set(id, name)
      }
    }
  } catch {
    // sem index — fallback para o primeiro prompt
  }
  return names
}

function isWrapperText(text: string): boolean {
  return CODEX_WRAPPER_PREFIXES.some(prefix => text.startsWith(prefix))
}

function joinContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(part =>
      typeof part === 'string'
        ? part
        : typeof part?.text === 'string'
          ? part.text
          : '',
    )
    .filter(Boolean)
    .join('\n')
}

function parseJsonLine(line: string): any | undefined {
  if (!line) return undefined
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

async function readFirstLine(path: string): Promise<string> {
  const fh = await fsOpen(path, 'r')
  try {
    // session_meta pode exceder 8KB (base_instructions embute o system
    // prompt) — lê em chunks até achar a quebra de linha.
    const chunks: Buffer[] = []
    let offset = 0
    const chunk = Buffer.alloc(FIRST_LINE_READ_BYTES)
    while (offset < FIRST_PROMPT_MAX_BYTES) {
      const { bytesRead } = await fh.read(chunk, 0, chunk.length, offset)
      if (bytesRead === 0) break
      const slice = Buffer.from(chunk.subarray(0, bytesRead))
      chunks.push(slice)
      if (slice.includes(0x0a)) {
        const full = Buffer.concat(chunks)
        const nl = full.indexOf(0x0a)
        return full.toString('utf8', 0, nl === -1 ? full.length : nl)
      }
      offset += bytesRead
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    await fh.close()
  }
}

/**
 * Lê o session_meta (primeira linha) de um rollout.
 * Retorna undefined se o arquivo não parecer um rollout válido.
 */
async function readSessionMeta(
  path: string,
): Promise<
  | {
      sessionId: string
      cwd: string
      cliVersion: string
      timestamp: string
    }
  | undefined
> {
  const firstLine = await readFirstLine(path)
  const parsed = parseJsonLine(firstLine)
  if (parsed?.type !== 'session_meta') return undefined
  const payload = parsed.payload ?? {}
  const sessionId = payload.id ?? payload.session_id
  const cwd = payload.cwd
  if (typeof sessionId !== 'string' || typeof cwd !== 'string') {
    return undefined
  }
  return {
    sessionId,
    cwd,
    cliVersion:
      typeof payload.cli_version === 'string' ? payload.cli_version : 'unknown',
    timestamp:
      typeof payload.timestamp === 'string'
        ? payload.timestamp
        : new Date().toISOString(),
  }
}

/** Varre ~/.codex/sessions recursivamente (YYYY/MM/DD) por rollouts. */
export async function listCodexRollouts(): Promise<CodexRolloutInfo[]> {
  const root = getCodexSessionsDir()
  const rolloutPaths: string[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) return
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const dirent of dirents) {
      const fullPath = join(dir, dirent.name)
      if (dirent.isDirectory()) {
        await walk(fullPath, depth + 1)
      } else if (
        dirent.isFile() &&
        dirent.name.startsWith('rollout-') &&
        dirent.name.endsWith('.jsonl')
      ) {
        rolloutPaths.push(fullPath)
      }
    }
  }

  await walk(root, 0)

  const rollouts: CodexRolloutInfo[] = []
  for (const path of rolloutPaths) {
    const meta = await readSessionMeta(path)
    if (!meta) continue
    let fileStat
    try {
      fileStat = await stat(path)
    } catch {
      continue
    }
    rollouts.push({
      path,
      sessionId: meta.sessionId,
      cwd: meta.cwd,
      startedAt: new Date(meta.timestamp),
      modified: new Date(fileStat.mtimeMs),
      size: fileStat.size,
    })
  }
  rollouts.sort((a, b) => b.modified.getTime() - a.modified.getTime())
  return rollouts
}

function extractUserPromptFromLine(line: string): string | undefined {
  const parsed = parseJsonLine(line)
  if (parsed?.type !== 'response_item') return undefined
  const payload = parsed.payload ?? {}
  if (payload.type !== 'message' || payload.role !== 'user') return undefined
  const text = joinContentText(payload.content)
  if (!text || isWrapperText(text)) return undefined
  return text
}

/**
 * Extrai o primeiro prompt real do usuário (para o título no /resume).
 * Leitura em chunks para não materializar rollouts grandes.
 */
export async function readCodexFirstPrompt(path: string): Promise<string> {
  const fh = await fsOpen(path, 'r')
  try {
    let carry = ''
    let offset = 0
    const chunk = Buffer.alloc(FIRST_PROMPT_CHUNK_BYTES)
    while (offset < FIRST_PROMPT_MAX_BYTES) {
      const { bytesRead } = await fh.read(chunk, 0, chunk.length, offset)
      if (bytesRead === 0) break
      offset += bytesRead
      carry += chunk.toString('utf8', 0, bytesRead)
      const lines = carry.split('\n')
      carry = lines.pop() ?? ''
      for (const line of lines) {
        const prompt = extractUserPromptFromLine(line)
        if (prompt !== undefined) return prompt
      }
    }
    return ''
  } finally {
    await fh.close()
  }
}

type RolloutMeta = {
  sessionId: string
  cwd: string
  cliVersion: string
}

/**
 * Converte as linhas de um rollout em entradas de transcript Claude
 * (passada única; `compacted` reseta o histórico acumulado no ponto).
 */
function convertRolloutLines(
  lines: string[],
  meta: RolloutMeta,
): { entries: Array<Record<string, unknown>>; firstPrompt: string } {
  const metaEntries: Array<Record<string, unknown>> = [
    { type: 'mode', mode: 'normal', sessionId: meta.sessionId },
  ]
  let messageEntries: Array<Record<string, unknown>> = []
  let parentUuid: string | null = null
  let firstPrompt = ''
  let lastModel = 'codex-import'

  const baseFields = (timestamp: string) => ({
    isSidechain: false,
    userType: 'external',
    cwd: meta.cwd,
    sessionId: meta.sessionId,
    version: `codex-${meta.cliVersion}`,
    timestamp,
  })

  const emit = (entry: Record<string, unknown>, timestamp: string) => {
    const full = {
      ...baseFields(timestamp),
      ...entry,
      uuid: randomUUID(),
      parentUuid,
    }
    parentUuid = full.uuid as string
    messageEntries.push(full)
  }

  const processMessageItem = (item: {
    role?: string
    content?: unknown
    id?: string
  }): void => {
    const text = joinContentText(item.content)
    if (!text) return
    if (item.role === 'user') {
      if (isWrapperText(text)) return
      if (!firstPrompt) firstPrompt = text
      emit({ type: 'user', message: { role: 'user', content: text } }, NOW())
    } else if (item.role === 'assistant') {
      emit(
        {
          type: 'assistant',
          message: {
            ...(item.id ? { id: item.id } : {}),
            type: 'message',
            role: 'assistant',
            model: lastModel,
            content: [{ type: 'text', text }],
          },
        },
        NOW(),
      )
    }
  }

  const processToolCall = (payload: Record<string, unknown>): void => {
    let input: Record<string, unknown>
    if (payload.type === 'function_call') {
      try {
        input = JSON.parse(payload.arguments as string) as Record<
          string,
          unknown
        >
      } catch {
        input = { arguments: payload.arguments }
      }
    } else {
      // custom_tool_call: input é o código-fonte JS do comando
      input =
        typeof payload.input === 'string'
          ? { command: payload.input }
          : ((payload.input as Record<string, unknown>) ?? {})
    }
    emit(
      {
        type: 'assistant',
        message: {
          ...(payload.id ? { id: payload.id as string } : {}),
          type: 'message',
          role: 'assistant',
          model: lastModel,
          content: [
            {
              type: 'tool_use',
              id: (payload.call_id as string) ?? `call_${randomUUID()}`,
              name: (payload.name as string) ?? 'codex_tool',
              input,
            },
          ],
        },
      },
      NOW(),
    )
  }

  const processToolOutput = (payload: Record<string, unknown>): void => {
    emit(
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id:
                (payload.call_id as string) ?? `call_${randomUUID()}`,
              content: joinContentText(payload.output),
            },
          ],
        },
      },
      NOW(),
    )
  }

  // Timestamp corrente da linha sendo processada (passada única).
  let currentTimestamp = new Date().toISOString()
  const NOW = () => currentTimestamp

  for (const line of lines) {
    const parsed = parseJsonLine(line)
    if (!parsed) continue
    if (typeof parsed.timestamp === 'string') {
      currentTimestamp = parsed.timestamp
    }

    if (parsed.type === 'event_msg') {
      const model = parsed.payload?.thread_settings?.model
      if (typeof model === 'string') lastModel = model
      continue
    }
    if (parsed.type === 'world_state') {
      const model = parsed.payload?.state?.collaboration_mode?.model
      if (typeof model === 'string') lastModel = model
      continue
    }
    if (parsed.type === 'compacted') {
      // O Codex substituiu o contexto: descarta o histórico convertido até
      // aqui e recomeça de replacement_history.
      messageEntries = []
      parentUuid = null
      const replacement: unknown[] = parsed.payload?.replacement_history ?? []
      for (const item of replacement) {
        if ((item as { type?: string })?.type === 'message') {
          processMessageItem(item as { role?: string; content?: unknown; id?: string })
        }
      }
      continue
    }
    if (parsed.type !== 'response_item') continue

    const payload = parsed.payload ?? {}
    switch (payload.type) {
      case 'message':
        processMessageItem(payload)
        break
      case 'custom_tool_call':
      case 'function_call':
        processToolCall(payload)
        break
      case 'custom_tool_call_output':
      case 'function_call_output':
        processToolOutput(payload)
        break
      default:
        // reasoning (criptografado), web_search_call, etc. — descartados
        break
    }
  }

  const entries = [...metaEntries, ...messageEntries]
  return { entries, firstPrompt }
}

/**
 * Converte um rollout do Codex em um arquivo de sessão Claude em
 * ~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl.
 *
 * Idempotente: se o destino já existe, retorna o caminho sem reescrever
 * (nunca sobrescreve uma sessão que já foi continuada no Verboo).
 */
export async function convertCodexRollout(
  rolloutPath: string,
): Promise<string> {
  const meta = await readSessionMeta(rolloutPath)
  if (!meta) {
    throw new Error(`Não é um rollout válido do Codex: ${rolloutPath}`)
  }
  const targetDir = getProjectDir(meta.cwd)
  const targetPath = join(targetDir, `${meta.sessionId}.jsonl`)
  if (existsSync(targetPath)) {
    return targetPath
  }

  const content = await readFile(rolloutPath, 'utf8')
  const lines = content.split('\n')
  const { entries, firstPrompt } = convertRolloutLines(lines, meta)

  // Título: nome da sessão no Codex (session_index.jsonl) > primeiro prompt
  const sessionNames = await readCodexSessionNames()
  const title = sessionNames.get(meta.sessionId) ?? firstPrompt
  if (title) {
    entries.splice(1, 0, {
      type: 'custom-title',
      sessionId: meta.sessionId,
      customTitle: `[codex] ${title.slice(0, 100)}`,
    })
  }

  await mkdir(targetDir, { recursive: true })
  await writeFile(
    targetPath,
    entries.map(entry => JSON.stringify(entry)).join('\n') + '\n',
    { mode: 0o600 },
  )
  return targetPath
}

/**
 * LogOptions (lite) dos rollouts do Codex para injetar nos loaders do
 * /resume. Rollouts já convertidos são pulados — a sessão nativa
 * (convertida) aparece pelo scan normal de ~/.claude/projects.
 */
export async function getCodexLogOptions(
  cwdFilter?: Set<string>,
): Promise<LogOption[]> {
  const rollouts = await listCodexRollouts()
  const sessionNames = await readCodexSessionNames()
  const logs: LogOption[] = []
  for (const rollout of rollouts) {
    if (cwdFilter && !cwdFilter.has(rollout.cwd)) continue
    const convertedPath = join(
      getProjectDir(rollout.cwd),
      `${rollout.sessionId}.jsonl`,
    )
    if (existsSync(convertedPath)) continue
    logs.push({
      date: rollout.modified.toISOString(),
      messages: [],
      isLite: true,
      fullPath: rollout.path,
      value: 0,
      created: rollout.startedAt,
      modified: rollout.modified,
      firstPrompt: sessionNames.get(rollout.sessionId) ?? '',
      messageCount: 0,
      fileSize: rollout.size,
      isSidechain: false,
      sessionId: rollout.sessionId,
      projectPath: rollout.cwd,
      importedFrom: 'codex',
    })
  }
  return logs
}
