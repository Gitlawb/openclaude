import { z } from 'zod/v4'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { GIT_ANALYSIS_TOOL_NAME } from './constants.js'
import { getDescription } from './prompt.js'
import { getToolUseSummary, renderToolResultMessage, renderToolUseErrorMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    operation: z
      .enum(['blame', 'log', 'diff-range', 'show-commit'])
      .describe('The git analysis operation to perform.'),
    file: z
      .string()
      .optional()
      .describe('File path for blame operation. Relative to the working directory.'),
    query: z
      .string()
      .optional()
      .describe('Search query for log operation (matches commit messages and code).'),
    author: z
      .string()
      .optional()
      .describe('Filter by author name or email (log operation).'),
    since: z
      .string()
      .optional()
      .describe('Show commits after this date (e.g., "2024-01-01", "2 weeks ago").'),
    until: z
      .string()
      .optional()
      .describe('Show commits before this date.'),
    refA: z
      .string()
      .optional()
      .describe('First ref (commit/branch/tag) for diff-range operation.'),
    refB: z
      .string()
      .optional()
      .describe('Second ref for diff-range operation. Defaults to HEAD.'),
    commit: z
      .string()
      .optional()
      .describe('Commit hash for show-commit operation.'),
    maxResults: z
      .number()
      .optional()
      .describe('Maximum number of results for log operation. Defaults to 30.'),
    lineStart: z
      .number()
      .optional()
      .describe('Start line number for blame operation (1-indexed).'),
    lineEnd: z
      .number()
      .optional()
      .describe('End line number for blame operation (1-indexed).'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

type GitAnalysisResult = {
  operation: string
  result: string
  summary: string
}

const outputSchema = lazySchema(() =>
  z.object({
    operation: z.string(),
    result: z.string(),
    summary: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

async function runGit(args: string[], signal?: AbortSignal): Promise<string> {
  const { execFile } = require('child_process') as typeof import('child_process')
  const cwd = getCwd()

  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024, signal }, (error, stdout, stderr) => {
      if (error) {
        if (error.name === 'AbortError') {
          reject(error)
          return
        }
        reject(new Error(`git ${args[0]} failed: ${stderr || error.message}`))
        return
      }
      resolve(stdout)
    })
  })
}

export const GitAnalysisTool = buildTool({
  name: GIT_ANALYSIS_TOOL_NAME,
  maxResultSizeChars: 30_000,
  strict: true,
  async description() {
    return getDescription()
  },
  userFacingName() {
    return 'Git Analysis'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Git: ${summary}` : 'Analyzing git history'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `${input.operation}${input.file ? ` ${input.file}` : ''}${input.query ? ` "${input.query}"` : ''}`
  },
  async validateInput(): Promise<ValidationResult> {
    return { result: true }
  },
  async checkPermissions() {
    return { behavior: 'allow' as const, updatedInput: undefined }
  },
  async prompt() {
    return getDescription()
  },
  renderToolUseMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `${output.summary}\n\n${output.result}`,
    }
  },
  async call(input, { abortController }) {
    const { operation, file, query, author, since, until, refA, refB, commit, maxResults, lineStart, lineEnd } = input

    try {
      switch (operation) {
        case 'blame': {
          if (!file) throw new Error('file is required for blame operation')
          const args = ['blame', '--porcelain']
          if (lineStart !== undefined && lineEnd !== undefined) {
            args.push('-L', `${lineStart},${lineEnd}`)
          }
          args.push(file)
          const result = await runGit(args, abortController.signal)
          // Parse porcelain format into readable output
          const lines = result.split('\n')
          const blameLines: string[] = []
          let currentCommit = ''
          let currentAuthor = ''
          let currentLine = 0
          for (const line of lines) {
            if (/^[0-9a-f]{40}\s+\d+\s+\d+/.test(line)) {
              const parts = line.split(/\s+/)
              currentCommit = parts[0]!.substring(0, 8)
              currentLine = parseInt(parts[2]!, 10)
            } else if (line.startsWith('author ')) {
              currentAuthor = line.substring(7)
            } else if (line.startsWith('\t')) {
              blameLines.push(`${currentLine}: [${currentCommit}] ${currentAuthor}: ${line.substring(1)}`)
            }
          }
          const resultText = blameLines.join('\n')
          return {
            data: {
              operation: 'blame',
              result: resultText.substring(0, 30_000),
              summary: `${file}: ${blameLines.length} lines blamed`,
            },
          }
        }

        case 'log': {
          const args = ['log', '--oneline', '--no-decorate', `-n${maxResults ?? 30}`]
          if (query) args.push(`--grep=${query}`, '-i')
          if (author) args.push(`--author=${author}`)
          if (since) args.push(`--since=${since}`)
          if (until) args.push(`--until=${until}`)
          if (file) args.push('--', file)
          const result = await runGit(args, abortController.signal)
          const lines = result.trim().split('\n').filter(Boolean)
          return {
            data: {
              operation: 'log',
              result: lines.join('\n'),
              summary: `${lines.length} commits found`,
            },
          }
        }

        case 'show-commit': {
          if (!commit) throw new Error('commit is required for show-commit operation')
          const result = await runGit(['show', '--stat', '--format=fuller', commit], abortController.signal)
          const lines = result.split('\n')
          const summaryLine = lines.find(l => l.startsWith('commit')) || commit
          return {
            data: {
              operation: 'show-commit',
              result: result.substring(0, 30_000),
              summary: summaryLine.substring(0, 100),
            },
          }
        }

        case 'diff-range': {
          if (!refA) throw new Error('refA is required for diff-range operation')
          const b = refB || 'HEAD'
          const args = ['diff', '--stat', `${refA}...${b}`]
          const statResult = await runGit(args, abortController.signal)
          const fullDiff = await runGit(['diff', `${refA}...${b}`], abortController.signal)
          const combined = `${statResult}\n\n${fullDiff}`
          return {
            data: {
              operation: 'diff-range',
              result: combined.substring(0, 30_000),
              summary: `${refA}...${b}: ${statResult.split('\n').filter(Boolean).length} files changed`,
            },
          }
        }

        default:
          throw new Error(`Unknown operation: ${operation}`)
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      return {
        data: {
          operation,
          result: `Error: ${error instanceof Error ? error.message : String(error)}`,
          summary: `${operation} failed`,
        },
      }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
