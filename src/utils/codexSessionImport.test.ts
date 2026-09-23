import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  convertCodexRollout,
  getCodexLogOptions,
  listCodexRollouts,
  readCodexFirstPrompt,
} from './codexSessionImport.js'

const SESSION_ID = '01a0ca5a-1730-7813-a5cb-04967a29fd8f'
const PROJECT_CWD = '/home/user/proj-x'

function rolloutLine(
  type: string,
  payload: Record<string, unknown>,
  timestamp = '2026-09-22T18:23:25.315Z',
): string {
  return JSON.stringify({ timestamp, type, payload })
}

function writeRollout(path: string, lines: string[]): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, lines.join('\n') + '\n')
}

function baseRolloutLines(): string[] {
  return [
    rolloutLine('session_meta', {
      session_id: SESSION_ID,
      id: SESSION_ID,
      cwd: PROJECT_CWD,
      timestamp: '2026-09-22T18:21:36.944Z',
      cli_version: '0.155.1',
    }),
    rolloutLine('event_msg', { type: 'task_started' }),
    // prompt de usuário "wrapper" — deve ser ignorado
    rolloutLine('response_item', {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }],
    }),
    // primeiro prompt real
    rolloutLine('response_item', {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'arruma o bug do checkout' }],
    }),
    // instrução de developer — ignorada
    rolloutLine('response_item', {
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: '<skills_instructions>...</skills_instructions>' }],
    }),
    // resposta do assistente
    rolloutLine('response_item', {
      type: 'message',
      id: 'msg_abc123',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'vou investigar o checkout' }],
    }),
    // tool call + output
    rolloutLine('response_item', {
      type: 'custom_tool_call',
      id: 'ctc_1',
      call_id: 'call_1',
      name: 'exec',
      input: 'tools.exec_command({cmd: "ls"})',
    }),
    rolloutLine('response_item', {
      type: 'custom_tool_call_output',
      id: 'cto_1',
      call_id: 'call_1',
      output: [{ type: 'input_text', text: 'src\nREADME.md' }],
    }),
    // reasoning — ignorado
    rolloutLine('response_item', {
      type: 'reasoning',
      encrypted_content: 'deadbeef',
    }),
    // turn aborted sintético — ignorado
    rolloutLine('response_item', {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '<turn_aborted>interrupted</turn_aborted>' }],
    }),
    // resposta final
    rolloutLine('response_item', {
      type: 'message',
      id: 'msg_def456',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'bug corrigido' }],
    }),
  ]
}

function compactedRolloutLines(sessionId: string): string[] {
  return [
    rolloutLine('session_meta', {
      session_id: sessionId,
      id: sessionId,
      cwd: PROJECT_CWD,
      cli_version: '0.155.1',
    }),
    rolloutLine('response_item', {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'prompt antigo pré-compact' }],
    }),
    rolloutLine('response_item', {
      type: 'message',
      id: 'msg_old',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'resposta antiga' }],
    }),
    rolloutLine('compacted', {
      replacement_history: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'resumo pós-compact do trabalho' }],
        },
        {
          type: 'message',
          id: 'msg_new',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'continuando de onde parei' }],
        },
      ],
    }),
    rolloutLine('response_item', {
      type: 'message',
      id: 'msg_final',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'última resposta pós-compact' }],
    }),
  ]
}

describe('codexSessionImport', () => {
  let codexDir: string
  let projectsDir: string
  let originalCodexDir: string | undefined
  let originalProjectsDir: string | undefined

  beforeAll(() => {
    const root = mkdtempSync(join(tmpdir(), 'codex-import-test-'))
    codexDir = join(root, 'codex-sessions')
    projectsDir = join(root, 'projects')
    mkdirSync(join(codexDir, '2026', '09', '22'), { recursive: true })
    // index de nomes do Codex no pai do diretório de sessões (como ~/.codex)
    writeFileSync(
      join(root, 'session_index.jsonl'),
      [
        JSON.stringify({
          id: '01a0c59e-5c1e-73c3-b2ec-b7aa1d785895',
          thread_name: 'Destaque usuários fora do fair-use',
        }),
        JSON.stringify({
          id: '01a0ca5a-1730-7813-a5cb-04967a29fd99',
          thread_name: 'Adicionar gráficos ao modal de custo',
        }),
      ].join('\n') + '\n',
    )
    originalCodexDir = process.env.VERBOO_CODEX_SESSIONS_DIR
    originalProjectsDir = process.env.VERBOO_PROJECTS_DIR
    process.env.VERBOO_CODEX_SESSIONS_DIR = codexDir
    process.env.VERBOO_PROJECTS_DIR = projectsDir
  })

  afterAll(() => {
    if (originalCodexDir === undefined) {
      delete process.env.VERBOO_CODEX_SESSIONS_DIR
    } else {
      process.env.VERBOO_CODEX_SESSIONS_DIR = originalCodexDir
    }
    if (originalProjectsDir === undefined) {
      delete process.env.VERBOO_PROJECTS_DIR
    } else {
      process.env.VERBOO_PROJECTS_DIR = originalProjectsDir
    }
    rmSync(join(codexDir, '..'), { recursive: true, force: true })
  })

  test('conversão completa: metadados, mensagens, tool pairing e cadeia parentUuid', async () => {
    const rolloutPath = join(
      codexDir,
      '2026',
      '09',
      '22',
      `rollout-2026-09-22T15-21-36-${SESSION_ID}.jsonl`,
    )
    writeRollout(rolloutPath, baseRolloutLines())

    const targetPath = await convertCodexRollout(rolloutPath)
    expect(targetPath).toBe(
      join(projectsDir, '-home-user-proj-x', `${SESSION_ID}.jsonl`),
    )
    expect(existsSync(targetPath)).toBe(true)

    const entries = readFileSync(targetPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))

    // 1ª linha: mode
    expect(entries[0]).toMatchObject({
      type: 'mode',
      mode: 'normal',
      sessionId: SESSION_ID,
    })
    // 2ª linha: custom-title com badge [codex] e o primeiro prompt real
    expect(entries[1]).toMatchObject({
      type: 'custom-title',
      sessionId: SESSION_ID,
      customTitle: '[codex] arruma o bug do checkout',
    })

    const messages = entries.filter(
      e => e.type === 'user' || e.type === 'assistant',
    )
    // user prompt + assistant + tool_use + tool_result + assistant final = 5
    // (wrappers, developer e reasoning são descartados)
    expect(messages).toHaveLength(5)

    // cadeia parentUuid coerente
    let parent: string | null = null
    for (const msg of messages) {
      expect(msg.parentUuid).toBe(parent)
      parent = msg.uuid
    }

    // user prompt real
    expect(messages[0].message.content).toBe('arruma o bug do checkout')
    // assistant texto
    expect(messages[1].message.content[0]).toMatchObject({
      type: 'text',
      text: 'vou investigar o checkout',
    })
    // tool_use
    expect(messages[2].message.content[0]).toMatchObject({
      type: 'tool_use',
      id: 'call_1',
      name: 'exec',
      input: { command: 'tools.exec_command({cmd: "ls"})' },
    })
    // tool_result pareado
    expect(messages[3].message.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'call_1',
      content: 'src\nREADME.md',
    })
    // última resposta
    expect(messages[4].message.content[0].text).toBe('bug corrigido')

    // campos de sessão presentes
    for (const msg of messages) {
      expect(msg.sessionId).toBe(SESSION_ID)
      expect(msg.cwd).toBe(PROJECT_CWD)
      expect(msg.version).toBe('codex-0.155.1')
      expect(msg.isSidechain).toBe(false)
      expect(typeof msg.timestamp).toBe('string')
    }
  })

  test('conversão é idempotente — não reescreve sessão já convertida', async () => {
    const rolloutPath = join(
      codexDir,
      '2026',
      '09',
      '22',
      `rollout-2026-09-22T15-21-36-${SESSION_ID}.jsonl`,
    )
    writeRollout(rolloutPath, baseRolloutLines())
    const first = await convertCodexRollout(rolloutPath)
    const contentBefore = readFileSync(first, 'utf8')

    // muda o rollout depois — a sessão convertida não pode ser sobrescrita
    writeRollout(rolloutPath, [
      ...baseRolloutLines(),
      rolloutLine('response_item', {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'novo prompt pós-conversão' }],
      }),
    ])
    const second = await convertCodexRollout(rolloutPath)
    expect(second).toBe(first)
    expect(readFileSync(second, 'utf8')).toBe(contentBefore)
  })

  test('compacted descarta histórico anterior e usa replacement_history', async () => {
    const compactedId = '01a0c59e-5c1e-73c3-b2ec-b7aa1d785895'
    const rolloutPath = join(
      codexDir,
      '2026',
      '09',
      '22',
      `rollout-2026-09-22T16-00-00-${compactedId}.jsonl`,
    )
    writeRollout(rolloutPath, compactedRolloutLines(compactedId))

    const targetPath = await convertCodexRollout(rolloutPath)
    const messages = readFileSync(targetPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
      .filter(e => e.type === 'user' || e.type === 'assistant')

    // replacement_history (user + assistant) + assistant final = 3
    expect(messages).toHaveLength(3)
    expect(messages[0].message.content).toBe('resumo pós-compact do trabalho')
    expect(messages[2].message.content[0].text).toBe('última resposta pós-compact')

    // título usa o thread_name do session_index.jsonl (não o prompt)
    const titleEntry = readFileSync(targetPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
      .find(e => e.type === 'custom-title')
    expect(titleEntry.customTitle).toBe(
      '[codex] Destaque usuários fora do fair-use',
    )
  })

  test('listCodexRollouts lista rollouts com cwd e sessionId', async () => {
    const rollouts = await listCodexRollouts()
    const paths = rollouts.map(r => r.path)
    expect(paths.some(p => p.endsWith(`${SESSION_ID}.jsonl`))).toBe(true)
    for (const r of rollouts) {
      expect(r.cwd).toBe(PROJECT_CWD)
      expect(typeof r.sessionId).toBe('string')
      expect(r.modified.getTime()).toBeGreaterThan(0)
    }
  })

  test('readCodexFirstPrompt extrai o primeiro prompt real', async () => {
    const rolloutPath = join(
      codexDir,
      '2026',
      '09',
      '22',
      `rollout-2026-09-22T15-21-36-${SESSION_ID}.jsonl`,
    )
    const prompt = await readCodexFirstPrompt(rolloutPath)
    expect(prompt).toBe('arruma o bug do checkout')
  })

  test('getCodexLogOptions injeta lite logs e pula já-convertidas', async () => {
    // o rollout base já foi convertido nos testes anteriores → não deve
    // aparecer; o compactado também. Cria um rollout novo.
    const freshId = '01a0ca5a-1730-7813-a5cb-04967a29fd99'
    const freshPath = join(
      codexDir,
      '2026',
      '09',
      '22',
      `rollout-2026-09-22T17-00-00-${freshId}.jsonl`,
    )
    writeRollout(freshPath, [
      rolloutLine('session_meta', {
        session_id: freshId,
        id: freshId,
        cwd: PROJECT_CWD,
        cli_version: '0.155.1',
      }),
      rolloutLine('response_item', {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'prompt do rollout fresco' }],
      }),
    ])

    const logs = await getCodexLogOptions(new Set([PROJECT_CWD]))
    const fresh = logs.find(l => l.sessionId === freshId)
    expect(fresh).toBeDefined()
    expect(fresh?.importedFrom).toBe('codex')
    expect(fresh?.isLite).toBe(true)
    expect(fresh?.fullPath).toBe(freshPath)
    expect(fresh?.projectPath).toBe(PROJECT_CWD)
    expect(fresh?.messages).toHaveLength(0)
    // firstPrompt vem do thread_name do index (não do prompt do rollout)
    expect(fresh?.firstPrompt).toBe('Adicionar gráficos ao modal de custo')

    // já convertida não aparece
    expect(logs.find(l => l.sessionId === SESSION_ID)).toBeUndefined()

    // filtro por cwd estranho → nada
    const other = await getCodexLogOptions(new Set(['/other/dir']))
    expect(other).toHaveLength(0)
  })
})
