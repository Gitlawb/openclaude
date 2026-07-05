import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ToolUseContext, Tools } from '../Tool.js'
import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js'
import type { DiagnosticFile } from '../services/diagnosticTracking.js'
import type { Attachment } from './attachments.js'

const debugMessages: string[] = []
const realDebugModule = await import(
  `./debug.js?real=${Date.now()}-${Math.random()}`,
)
const realLSPRegistry = await import(
  `../services/lsp/LSPDiagnosticRegistry.ts?real=${Date.now()}-${Math.random()}`,
)

let diagnosticSets: Array<{ serverName: string; files: DiagnosticFile[] }> = []

const checkForLSPDiagnosticsMock = mock(() => diagnosticSets)
const clearAllLSPDiagnosticsMock = mock(() => {
  diagnosticSets = []
})

mock.module('./debug.js', () => ({
  ...realDebugModule,
  logForDebugging: mock((message: string) => {
    debugMessages.push(message)
  }),
}))

mock.module('../services/lsp/LSPDiagnosticRegistry.js', () => ({
  ...realLSPRegistry,
  checkForLSPDiagnostics: checkForLSPDiagnosticsMock,
  clearAllLSPDiagnostics: clearAllLSPDiagnosticsMock,
}))

const { getAttachmentMessages } = await import(
  `./attachments.ts?test=${Date.now()}-${Math.random()}`
)

const SAVED_SIMPLE = process.env.CLAUDE_CODE_SIMPLE
const SAVED_DISABLE_ATTACHMENTS = process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS

type DiagnosticsAttachment = Extract<Attachment, { type: 'diagnostics' }>

function makeToolUseContext(): ToolUseContext {
  let inProgressToolUseIDs = new Set<string>()

  return {
    abortController: new AbortController(),
    readFileState: {} as ToolUseContext['readFileState'],
    getAppState: () => ({
      fastMode: false,
      mcp: { tools: {}, clients: [] },
      toolPermissionContext: { mode: 'default' },
      sessionHooks: new Map(),
      mainLoopModel: 'gpt-4o',
      effortValue: undefined,
      advisorModel: undefined,
    }),
    setAppState: () => {},
    options: {
      commands: [],
      debug: false,
      thinkingConfig: { type: 'disabled' },
      tools: [{ name: BASH_TOOL_NAME } as Tools[number]],
      verbose: false,
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], allowedAgentTypes: undefined },
      mainLoopModel: 'gpt-4o',
    },
    nestedMemoryAttachmentTriggers: new Set(),
    loadedNestedMemoryPaths: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
    setInProgressToolUseIDs: updater => {
      inProgressToolUseIDs = updater(inProgressToolUseIDs)
    },
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as unknown as ToolUseContext
}

async function collectLSPDiagnosticAttachments(): Promise<
  DiagnosticsAttachment[]
> {
  const diagnosticsAttachments: DiagnosticsAttachment[] = []

  for await (const message of getAttachmentMessages(
    null,
    makeToolUseContext(),
    null,
    [],
    [],
    'compact',
    { skipSkillDiscovery: true },
  )) {
    if (message.attachment.type === 'diagnostics') {
      diagnosticsAttachments.push(message.attachment)
    }
  }

  return diagnosticsAttachments
}

describe('LSP diagnostic attachment filtering', () => {
  beforeEach(() => {
    delete process.env.CLAUDE_CODE_SIMPLE
    delete process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS
    diagnosticSets = []
    debugMessages.length = 0
    checkForLSPDiagnosticsMock.mockClear()
    clearAllLSPDiagnosticsMock.mockClear()
  })

  afterEach(() => {
    if (SAVED_SIMPLE === undefined) {
      delete process.env.CLAUDE_CODE_SIMPLE
    } else {
      process.env.CLAUDE_CODE_SIMPLE = SAVED_SIMPLE
    }
    if (SAVED_DISABLE_ATTACHMENTS === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS
    } else {
      process.env.CLAUDE_CODE_DISABLE_ATTACHMENTS = SAVED_DISABLE_ATTACHMENTS
    }
  })

  test('does not return a diagnostics attachment for an empty final LSP payload', async () => {
    diagnosticSets = [
      {
        serverName: 'typescript',
        files: [{ uri: '/repo/src/clean.ts', diagnostics: [] }],
      },
    ]

    const attachments = await collectLSPDiagnosticAttachments()

    expect(attachments).toEqual([])
    expect(clearAllLSPDiagnosticsMock).not.toHaveBeenCalled()
    expect(debugMessages).toContain(
      'LSP Diagnostics: No diagnostic attachments to return after filtering empty diagnostic payloads',
    )
  })

  test('returns a diagnostics attachment for a compact storm summary-only payload', async () => {
    const summaryFile: DiagnosticFile = {
      uri: 'lsp://diagnostic-storm/typescript',
      diagnostics: [
        {
          message:
            'LSP diagnostic storm: server=typescript raw=210 duplicates=210 dropped=0 delivered=0 topFiles=[noisy.ts:210]',
          severity: 'Info',
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          source: 'openclaude-lsp',
          code: 'diagnostic-storm',
        },
      ],
    }
    diagnosticSets = [{ serverName: 'typescript', files: [summaryFile] }]

    const attachments = await collectLSPDiagnosticAttachments()

    expect(attachments).toEqual([
      { type: 'diagnostics', files: [summaryFile], isNew: true },
    ])
    expect(clearAllLSPDiagnosticsMock).toHaveBeenCalledTimes(1)
    expect(debugMessages).toContain(
      'LSP Diagnostics: Returning 1 diagnostic attachment(s)',
    )
  })
})
