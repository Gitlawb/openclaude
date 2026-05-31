import { z } from 'zod/v4'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { CODE_ANALYSIS_TOOL_NAME } from './constants.js'
import { getDescription } from './prompt.js'
import { getToolUseSummary, renderToolResultMessage, renderToolUseErrorMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    operation: z
      .enum(['complexity', 'dead-code', 'imports', 'duplicates', 'size'])
      .describe('The code analysis operation to perform.'),
    path: z
      .string()
      .optional()
      .describe('File or directory to analyze. Defaults to current working directory.'),
    maxDepth: z
      .number()
      .optional()
      .describe('Maximum directory depth for recursive operations. Defaults to 3.'),
    extensions: z
      .string()
      .optional()
      .describe('Comma-separated file extensions to include (e.g., "ts,tsx,js,jsx"). Defaults to common source extensions.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

type CodeAnalysisResult = {
  operation: string
  summary: string
  details: string
}

const outputSchema = lazySchema(() =>
  z.object({
    operation: z.string(),
    summary: z.string(),
    details: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.hpp']

function getExtensions(extensions?: string): string[] {
  if (!extensions) return DEFAULT_EXTENSIONS
  return extensions.split(',').map(e => e.trim().startsWith('.') ? e.trim() : `.${e.trim()}`)
}

function walkDirectory(dir: string, maxDepth: number, extensions: string[], currentDepth = 0): string[] {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')

  if (currentDepth > maxDepth) return []

  const files: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor' || entry.name === '__pycache__') continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...walkDirectory(fullPath, maxDepth, extensions, currentDepth + 1))
      } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
        files.push(fullPath)
      }
    }
  } catch { /* ignore permission errors */ }
  return files
}

function calculateComplexity(content: string): Array<{ name: string; line: number; complexity: number }> {
  const results: Array<{ name: string; line: number; complexity: number }> = []
  const lines = content.split('\n')

  // Detect functions across multiple languages
  const funcPatterns = [
    // JS/TS: function foo(), const foo = (), arrow functions, methods
    { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/, isPython: false },
    { regex: /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/, isPython: false },
    { regex: /(?:public|private|protected|static|async|override)\s+(\w+)\s*\(/, isPython: false },
    // Python
    { regex: /def\s+(\w+)\s*\(/, isPython: true },
    // Go
    { regex: /func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/, isPython: false },
    // Rust
    { regex: /fn\s+(\w+)\s*[<(]/, isPython: false },
    // Java/C++
    { regex: /(?:public|private|protected|static|final|abstract|synchronized|native)\s+[\w<>\[\]]+\s+(\w+)\s*\(/, isPython: false },
  ]

  let currentFunc: { name: string; line: number; isPython: boolean } | null = null
  let braceDepth = 0
  let complexity = 1
  let funcIndent = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()

    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue

    // Detect function start
    if (!currentFunc) {
      for (const { regex, isPython } of funcPatterns) {
        const match = trimmed.match(regex)
        if (match && match[1]) {
          currentFunc = { name: match[1], line: i + 1, isPython }
          complexity = 1
          braceDepth = 0
          funcIndent = line.length - line.trimStart().length
          break
        }
      }
    }

    if (currentFunc) {
      // Count complexity-increasing constructs
      if (/\b(if|else\s+if|elif|case|catch|&&|\|\||\?)\b/.test(trimmed)) complexity++
      if (/\b(for|while|do)\b/.test(trimmed)) complexity++
      if (/\b(switch|match)\b/.test(trimmed)) complexity++

      if (currentFunc.isPython) {
        // Python: track scope via indentation
        if (trimmed.length === 0) continue // skip blank lines
        const indent = line.length - line.trimStart().length
        // Function ends when a non-blank line returns to the function's indent level
        // (and it's not the function definition line itself)
        if (indent <= funcIndent && i > currentFunc.line - 1) {
          if (complexity > 5) {
            results.push({ name: currentFunc.name, line: currentFunc.line, complexity })
          }
          currentFunc = null
        }
      } else {
        // Brace-based languages: count braces for scope tracking
        for (const ch of line) {
          if (ch === '{') braceDepth++
          if (ch === '}') braceDepth--
        }
        // End of function (brace depth returns to 0 or less)
        if (braceDepth <= 0 && (trimmed === '}' || trimmed.startsWith('}'))) {
          if (complexity > 5) {
            results.push({ name: currentFunc.name, line: currentFunc.line, complexity })
          }
          currentFunc = null
        }
      }
    }
  }

  return results.sort((a, b) => b.complexity - a.complexity)
}

function analyzeImports(content: string, _filePath: string): { imports: string[]; exports: string[] } {
  const lines = content.split('\n')
  const imports: string[] = []
  const exports: string[] = []

  let inGoImportBlock = false

  for (const line of lines) {
    const trimmed = line.trim()
    // ES imports
    const importMatch = trimmed.match(/import\s+(?:.*\s+from\s+)?['"]([^'"]+)['"]/)
    if (importMatch) { imports.push(importMatch[1]!); continue }
    // CommonJS requires
    const requireMatch = trimmed.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/)
    if (requireMatch) { imports.push(requireMatch[1]!); continue }
    // Go imports: track block imports (import ( ... )) and single-line imports
    if (trimmed === 'import (') { inGoImportBlock = true; continue }
    if (inGoImportBlock) {
      if (trimmed === ')') { inGoImportBlock = false; continue }
      const goBlockImport = trimmed.match(/^"([^"]+)"$/)
      if (goBlockImport) { imports.push(goBlockImport[1]!) }
      continue
    }
    if (trimmed.startsWith('import ')) {
      const goSingleImport = trimmed.match(/^import\s+"([^"]+)"$/)
      if (goSingleImport) { imports.push(goSingleImport[1]!) }
      continue
    }
    // Python imports
    const pyImportMatch = trimmed.match(/(?:from\s+(\S+)\s+)?import\s+(\S+)/)
    if (pyImportMatch) imports.push(pyImportMatch[1] || pyImportMatch[2]!)

    // Exports
    if (trimmed.startsWith('export ') || trimmed.startsWith('export\t')) exports.push(trimmed.substring(0, 80))
  }

  return { imports, exports }
}

export const CodeAnalysisTool = buildTool({
  name: CODE_ANALYSIS_TOOL_NAME,
  maxResultSizeChars: 30_000,
  strict: true,
  async description() {
    return getDescription()
  },
  userFacingName() {
    return 'Code Analysis'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Analyzing: ${summary}` : 'Analyzing code'
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
    return `${input.operation}${input.path ? ` ${input.path}` : ''}`
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
      content: `${output.summary}\n\n${output.details}`,
    }
  },
  async call(input, { abortController }) {
    const { operation, path: inputPath, maxDepth, extensions: extStr } = input
    const fs = require('fs') as typeof import('fs')
    const pathMod = require('path') as typeof import('path')
    const cwd = getCwd()
    const targetPath = inputPath ? pathMod.resolve(cwd, inputPath) : cwd
    const exts = getExtensions(extStr)

    try {
      switch (operation) {
        case 'complexity': {
          const stat = fs.statSync(targetPath)
          if (stat.isFile()) {
            const content = fs.readFileSync(targetPath, 'utf8')
            const results = calculateComplexity(content)
            const highComplexity = results.filter(r => r.complexity > 10)
            return {
              data: {
                operation: 'complexity',
                summary: `${results.length} complex functions found, ${highComplexity.length} with high complexity (>10)`,
                details: results.map(r => `  Line ${r.line}: ${r.name} — complexity ${r.complexity}`).join('\n') || 'No high-complexity functions detected.',
              },
            }
          }
          // Directory mode
          const files = walkDirectory(targetPath, maxDepth ?? 3, exts)
          const allResults: Array<{ file: string; name: string; line: number; complexity: number }> = []
          for (const file of files.slice(0, 100)) {
            try {
              const content = fs.readFileSync(file, 'utf8')
              const relPath = pathMod.relative(cwd, file)
              for (const r of calculateComplexity(content)) {
                allResults.push({ file: relPath, ...r })
              }
            } catch { /* skip unreadable files */ }
          }
          allResults.sort((a, b) => b.complexity - a.complexity)
          const topResults = allResults.slice(0, 50)
          return {
            data: {
              operation: 'complexity',
              summary: `${files.length} files scanned, ${allResults.length} complex functions, ${allResults.filter(r => r.complexity > 10).length} high complexity`,
              details: topResults.map(r => `  ${r.file}:${r.line}: ${r.name} — complexity ${r.complexity}`).join('\n') || 'No high-complexity functions found.',
            },
          }
        }

        case 'dead-code': {
          const stat = fs.statSync(targetPath)
          const files = stat.isFile() ? [targetPath] : walkDirectory(targetPath, maxDepth ?? 3, exts)

          // Collect all exports and all imports across files
          const fileExports = new Map<string, Set<string>>()
          const allImports = new Set<string>()

          for (const file of files.slice(0, 200)) {
            try {
              const content = fs.readFileSync(file, 'utf8')
              const relPath = pathMod.relative(cwd, file)
              const { imports, exports } = analyzeImports(content, relPath)
              imports.forEach(i => allImports.add(i))
              if (exports.length > 0) {
                fileExports.set(relPath, new Set(exports))
              }
            } catch { /* skip */ }
          }

          // Files with exports but never imported by others
          const potentiallyUnused: string[] = []
          for (const [file, exports] of fileExports) {
            // Check if any other file imports from this file's path
            const importBase = file.replace(/\.(ts|tsx|js|jsx)$/, '')
            const isImported = [...allImports].some(imp =>
              imp.includes(importBase) || importBase.includes(imp.replace(/^\.\//, ''))
            )
            if (!isImported && exports.size > 0) {
              potentiallyUnused.push(`${file} (${exports.size} exports)`)
            }
          }

          return {
            data: {
              operation: 'dead-code',
              summary: `${files.length} files analyzed, ${potentiallyUnused.length} potentially unused modules`,
              details: potentiallyUnused.length > 0
                ? `Potentially unused modules (exported but not imported by other files):\n${potentiallyUnused.map(f => `  ${f}`).join('\n')}`
                : 'No obviously unused modules detected.',
            },
          }
        }

        case 'imports': {
          const stat = fs.statSync(targetPath)
          if (stat.isFile()) {
            const content = fs.readFileSync(targetPath, 'utf8')
            const { imports, exports } = analyzeImports(content, targetPath)
            return {
              data: {
                operation: 'imports',
                summary: `${imports.length} imports, ${exports.length} exports`,
                details: `Imports:\n${imports.map(i => `  ${i}`).join('\n') || '  (none)'}\n\nExports:\n${exports.map(e => `  ${e}`).join('\n') || '  (none)'}`,
              },
            }
          }

          // Directory mode: build dependency graph
          const files = walkDirectory(targetPath, maxDepth ?? 3, exts)
          const graph: Array<{ file: string; imports: string[] }> = []
          for (const file of files.slice(0, 200)) {
            try {
              const content = fs.readFileSync(file, 'utf8')
              const relPath = pathMod.relative(cwd, file)
              const { imports } = analyzeImports(content, relPath)
              graph.push({ file: relPath, imports })
            } catch { /* skip */ }
          }

          // Find most imported modules
          const importCounts = new Map<string, number>()
          for (const entry of graph) {
            for (const imp of entry.imports) {
              importCounts.set(imp, (importCounts.get(imp) || 0) + 1)
            }
          }
          const topImports = [...importCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)

          return {
            data: {
              operation: 'imports',
              summary: `${files.length} files, ${importCounts.size} unique imports`,
              details: `Top imported modules:\n${topImports.map(([mod, count]) => `  ${mod}: ${count} importers`).join('\n')}`,
            },
          }
        }

        case 'duplicates': {
          const files = walkDirectory(targetPath, maxDepth ?? 2, exts)
          const blockMap = new Map<string, string[]>()
          const BLOCK_SIZE = 6

          for (const file of files.slice(0, 100)) {
            try {
              const content = fs.readFileSync(file, 'utf8')
              const relPath = pathMod.relative(cwd, file)
              const lines = content.split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 10 && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('#'))

              for (let i = 0; i <= lines.length - BLOCK_SIZE; i++) {
                const block = lines.slice(i, i + BLOCK_SIZE).join('\n')
                if (block.length > 100) {
                  const hash = block
                  const existing = blockMap.get(hash) || []
                  if (!existing.includes(relPath)) {
                    existing.push(relPath)
                    blockMap.set(hash, existing)
                  }
                }
              }
            } catch { /* skip */ }
          }

          const duplicates = [...blockMap.entries()]
            .filter(([, files]) => files.length > 1)
            .slice(0, 20)

          return {
            data: {
              operation: 'duplicates',
              summary: `${duplicates.length} duplicate code blocks found across files`,
              details: duplicates.length > 0
                ? duplicates.map(([, files], i) => `  Block ${i + 1}: found in ${files.join(', ')}`).join('\n')
                : 'No significant duplicate blocks detected.',
            },
          }
        }

        case 'size': {
          const files = walkDirectory(targetPath, maxDepth ?? 5, getExtensions(undefined))
          const fileStats: Array<{ path: string; lines: number; bytes: number }> = []

          for (const file of files.slice(0, 500)) {
            try {
              const content = fs.readFileSync(file, 'utf8')
              const stat = fs.statSync(file)
              fileStats.push({
                path: pathMod.relative(cwd, file),
                lines: content.split('\n').length,
                bytes: stat.size,
              })
            } catch { /* skip */ }
          }

          fileStats.sort((a, b) => b.lines - a.lines)
          const totalLines = fileStats.reduce((sum, f) => sum + f.lines, 0)
          const totalBytes = fileStats.reduce((sum, f) => sum + f.bytes, 0)
          const largest = fileStats.slice(0, 20)

          return {
            data: {
              operation: 'size',
              summary: `${fileStats.length} files, ${totalLines.toLocaleString()} lines, ${(totalBytes / 1024).toFixed(1)}KB`,
              details: `Largest files:\n${largest.map(f => `  ${f.path}: ${f.lines} lines (${(f.bytes / 1024).toFixed(1)}KB)`).join('\n')}`,
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
          summary: `${operation} failed`,
          details: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
