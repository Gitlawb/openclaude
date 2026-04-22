// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, readFileSync as readFile } from 'fs'
import { resolve, join, basename } from 'path'
import { DESCRIPTION } from './prompt.js'
import { sessions_spawn } from '../../subagentSystem.js'

const DUCKHIVE_DIR = join(process.env.HOME ?? '~', '.duckhive')
const EXPORTS_DIR = join(DUCKHIVE_DIR, 'exports')

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['setup', 'detect', 'config']).describe('Init action: detect (preview), setup (run), config (manage DuckHive)'),
    workspaceRoot: z.string().optional().describe('Workspace root path (defaults to cwd)'),
    configKey: z.string().optional().describe('Config key to set (config action)'),
    configValue: z.string().optional().describe('Config value to set (config action)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    filesCreated: z.array(z.string()).optional(),
    preview: z.array(z.object({ file: z.string(), exists: z.boolean(), reason: z.string() })).optional(),
    configUpdated: z.boolean().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

// ─── Workspace analysis helpers ────────────────────────────────────────────────

async function analyzeWorkspace(root: string): Promise<{
  packageJson: Record<string, unknown> | null
  readmeContent: string | null
  existingFiles: { path: string; content: string }[]
  projectType: string
  language: string
  buildSystem: string
  hasSrc: boolean
  hasTests: boolean
  hasConfig: string[]
}> {
  const packageJsonPath = resolve(root, 'package.json')
  const readmePath = resolve(root, 'README.md')

  let packageJson: Record<string, unknown> | null = null
  if (existsSync(packageJsonPath)) {
    try {
      packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    } catch { /* ignore */ }
  }

  let readmeContent: string | null = null
  if (existsSync(readmePath)) {
    readmeContent = readFileSync(readmePath, 'utf8').slice(0, 3000)
  }

  // Scan existing workspace files
  const existingFiles: { path: string; content: string }[] = []
  for (const file of ['AGENTS.md', 'SOUL.md', 'TOOLS.md', '.claude', '.cursorrules', 'CLAUDE.md'] as const) {
    const p = resolve(root, file)
    if (existsSync(p)) {
      existingFiles.push({ path: file, content: readFileSync(p, 'utf8').slice(0, 2000) })
    }
  }

  // Detect project type
  let projectType = 'unknown'
  let language = 'unknown'
  let buildSystem = 'none'

  if (packageJson) {
    const deps = { ...(packageJson['dependencies'] as Record<string, string> ?? {}), ...(packageJson['devDependencies'] as Record<string, string> ?? {}) }
    if (deps['react'] || deps['next']) projectType = 'react'
    else if (deps['vue']) projectType = 'vue'
    else if (deps['svelte']) projectType = 'svelte'
    else if (deps['express'] || deps['fastify'] || deps['koa']) projectType = 'nodejs-api'
    else if (deps['next']) projectType = 'nextjs'
    else if (deps['typescript']) projectType = 'typescript'
    else projectType = 'nodejs'

    if (deps['typescript']) language = 'typescript'
    else if (deps['python']) language = 'python'
    else if (deps['rust']) language = 'rust'
    else if (deps['go']) language = 'go'
    else language = 'javascript'

    if (existsSync(resolve(root, 'Cargo.toml'))) buildSystem = 'cargo'
    else if (existsSync(resolve(root, 'go.mod'))) buildSystem = 'go'
    else if (packageJson) buildSystem = 'npm'
    else buildSystem = 'none'
  } else {
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      const srcDir = resolve(root, 'src')
      if (existsSync(srcDir)) {
        const entries = readdirSync(srcDir).filter(e => e.endsWith(ext))
        if (entries.length > 0) { language = ext.replace('.', ''); break }
      }
    }
    if (existsSync(resolve(root, 'Cargo.toml'))) { projectType = 'rust'; buildSystem = 'cargo'; language = 'rust' }
    else if (existsSync(resolve(root, 'go.mod'))) { projectType = 'go'; buildSystem = 'go'; language = 'go' }
    else if (existsSync(resolve(root, 'pyproject.toml'))) { projectType = 'python'; buildSystem = 'pip'; language = 'python' }
    else if (existsSync(resolve(root, 'Makefile'))) { projectType = 'c'; buildSystem = 'make'; language = 'c' }
  }

  const hasSrc = existsSync(resolve(root, 'src'))
  const hasTests = existsSync(resolve(root, 'tests')) || existsSync(resolve(root, 'test')) || existsSync(resolve(root, '__tests__')) || existsSync(resolve(root, 'spec'))
  const hasConfig = ['tsconfig.json', 'jsconfig.json', '.eslintrc', '.prettierrc', 'vite.config.ts', 'next.config.js', 'webpack.config.js', 'Cargo.toml', 'go.mod'].filter(f => existsSync(resolve(root, f)))

  return { packageJson, readmeContent, existingFiles, projectType, language, buildSystem, hasSrc, hasTests, hasConfig }
}

async function runDeepAnalysis(root: string): Promise<string> {
  // Spawn a sub-agent for deep codebase analysis
  const spawnResult = await sessions_spawn({
    mode: 'run',
    runtime: 'subagent',
    task: `Analyze the codebase at "${root}" thoroughly and return a comprehensive summary including:\n1. Project architecture (folder structure, main entry points)\n2. Key conventions (naming, patterns, testing approach)\n3. Build and test commands (from package.json, Makefile, Cargo.toml, etc.)\n4. Tech stack details (frameworks, libraries, important dependencies)\n5. Any existing AI assistant instructions (AGENTS.md, SOUL.md, .cursorrules, CLAUDE.md, .claude)\n\nBe thorough — scan package.json, tsconfig.json, README.md, src/ directory structure, test conventions, and any config files. Return your analysis as structured markdown.`,
    label: `workspace-analysis-${Date.now()}`,
  })
  return spawnResult
}

function buildAgentsMd(analysis: Awaited<ReturnType<typeof analyzeWorkspace>>, deepAnalysis: string, root: string): string {
  const { packageJson, projectType, language, buildSystem, hasSrc, hasTests, hasConfig } = analysis

  const scripts: Record<string, string> = packageJson?.['scripts'] as Record<string, string> ?? {}
  const installCmd = buildSystem === 'npm' ? 'npm install' : buildSystem === 'cargo' ? 'cargo build' : buildSystem === 'go' ? 'go mod download' : '# no package manager detected'
  const buildCmd = scripts['build'] ?? (buildSystem === 'npm' ? 'npm run build' : buildSystem === 'cargo' ? 'cargo build' : buildSystem === 'go' ? 'go build ./...' : '# no build command detected')
  const testCmd = scripts['test'] ?? (buildSystem === 'npm' ? 'npm test' : buildSystem === 'cargo' ? 'cargo test' : '# no test command detected')
  const devCmd = scripts['dev'] ?? scripts['start'] ?? '# no dev command detected'


  // Guard: ensure deepAnalysis is always a string before using string methods
  const analysisText: string = (typeof deepAnalysis === 'string')
    ? deepAnalysis
    : (deepAnalysis && typeof deepAnalysis === 'object' ? JSON.stringify(deepAnalysis) : '')
  const analysisLines = analysisText.split('\\n')
  const techStack = analysisLines.filter((l: string) => l.includes('## Tech Stack') || l.includes('**')).slice(0, 20).join('\\n') || 'Not detected from analysis'
  const conventions = analysisText.includes('## Conventions') ? analysisText.split('## Conventions')[1]?.split('##')[0]?.trim() : 'Standard project conventions apply.'
  const aiFiles = analysisText.includes('## AI Assistant') ? analysisText.split('## AI Assistant')[1]?.split('##')[0]?.trim() : 'No existing AI instruction files detected.'
  return `# AGENTS.md — Project Reference

## Project Overview
- **Type:** ${projectType}
- **Language:** ${language}
- **Build System:** ${buildSystem}

## Directory Structure
\`\`\`
${basename(root)}
${hasSrc ? '├── src/' : '└── (no src/ directory)'}
${hasTests ? '├── tests/ or test/' : ''}
${hasConfig.length > 0 ? '├── ' + hasConfig.slice(0, 3).join('\n├── ') : ''}
└── README.md
\`\`\`

## Build & Test Commands
\`\`\`bash
# Install dependencies
${installCmd}

# Development
${devCmd}

# Build
${buildCmd}

# Tests
${testCmd}
\`\`\`

## Tech Stack
${techStack}

## Conventions
${conventions}

## AI Assistant Files
${aiFiles}
`
}

function buildSoulMd(): string {
  return `# SOUL.md — Team Culture

## Values
- **Quality first:** Write code that's maintainable and well-tested
- **Clear communication:** Explain the "why" not just the "what"
- **Incremental progress:** Ship small, verify often, iterate fast
- **Transparency:** Be honest about problems and unknowns

## Communication Style
- Technical and precise, with enough context to be actionable
- Prefer code examples and concrete recommendations
- Acknowledge uncertainty and trade-offs openly

## Workflow
1. Understand the goal before writing code
2. Make changes incrementally with tests
3. Review and refine before shipping
4. Document decisions for the team
`
}

function buildToolsMd(): string {
  return `# TOOLS.md — Project Tooling

## Available Tools
This project uses the following tool categories:

### File Operations
- \`FileReadTool\` — Read files with optional line limits
- \`FileWriteTool\` — Create/overwrite files
- \`FileEditTool\` — Make targeted edits to files

### Code Execution
- \`BashTool\` — Execute shell commands with proper escaping
- \`GrepTool\` — Search code with pattern matching
- \`GlobTool\` — Find files by patterns

### Git & Version Control
- \`ShadowGitTool\` — Experimental git operations

### AI Collaboration
- \`HiveCouncilTool\` — AI Council deliberation
- \`HiveTeamTool\` — Multi-agent team coordination

### Web & Research
- \`WebSearchTool\` — Search the web
- \`WebFetchTool\` — Fetch page content

### Task Management
- \`TaskListTool\` — List active tasks
- \`TaskCreateTool\` — Create tasks
- \`TaskUpdateTool\` — Update task status

## Best Practices
- Use the right tool for the job
- Prefer safe tools (read-only) over dangerous ones (write/exec)
- Batch operations when possible
- Check outputs before proceeding
`
}

function buildConfig(): string {
  return JSON.stringify({
    version: '1.0',
    providers: {
      default: 'claude',
      fallback: 'openrouter',
    },
    models: {
      default: 'claude-sonnet-4',
      coding: 'claude-sonnet-4',
      fast: 'claude-haiku-3',
    },
    features: {
      council: true,
      teamTools: true,
      checkpoint: true,
    },
    workspace: {
      autoDetect: true,
      scanOnInit: true,
    },
  }, null, 2)
}

// ─── Main tool ────────────────────────────────────────────────────────────────

export const InitTool = buildTool({
  name: 'init_tool',
  async description() { return DESCRIPTION },
  async prompt() { return DESCRIPTION },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  isConcurrencySafe() { return false },
  isReadOnly(input) { return input.action === 'detect' },
  mapToolResultToToolResultBlockParam(data: Output, toolUseID: string) {
    if (data.success) {
      const parts: string[] = []
      if (data.action === 'detect' && data.preview) {
        parts.push('**Files that would be created:**')
        for (const p of data.preview) {
          parts.push(`  ${p.exists ? '🔄' : '✨'} ${p.file} — ${p.reason}`)
        }
      }
      if (data.action === 'setup' && data.filesCreated) {
        parts.push('**Created files:**')
        for (const f of data.filesCreated) {
          parts.push(`  ✅ ${f}`)
        }
      }
      if (data.action === 'config') {
        parts.push(data.configUpdated ? '✅ Config updated' : '❌ Config update failed')
      }
      return {
        tool_use_id: toolUseID,
        type: 'tool_result' as const,
        content: parts.length > 0 ? parts.join('\n') : JSON.stringify(data),
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: `Error: ${data.error ?? 'unknown error'}`,
      is_error: true,
    }
  },
  async call(input, context, canUseTool, parentMessage) {
    const { action, workspaceRoot, configKey, configValue } = input
    const root = workspaceRoot ?? process.cwd()

    // ── config action ──────────────────────────────────────────────────────────
    if (action === 'config') {
      // Ensure .duckhive dir exists
      try {
        const { mkdirSync } = await import('fs')
        mkdirSync(DUCKHIVE_DIR, { recursive: true })
      } catch { /* dir may already exist */ }

      const configPath = resolve(DUCKHIVE_DIR, 'config.json')
      let config: Record<string, unknown> = {}
      if (existsSync(configPath)) {
        try { config = JSON.parse(readFileSync(configPath, 'utf8')) } catch { /* ignore */ }
      }

      if (configKey && configValue !== undefined) {
        // Set value (support dot notation like "providers.default")
        const keys = configKey.split('.')
        let current: Record<string, unknown> = config
        for (let i = 0; i < keys.length - 1; i++) {
          const k = keys[i]!
          if (!current[k] || typeof current[k] !== 'object') current[k] = {}
          current = current[k] as Record<string, unknown>
        }
        current[keys[keys.length - 1]!] = configValue
        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
        return { data: { success: true, action: 'config', configUpdated: true } }
      } else {
        // Show current config
        return { data: { success: true, action: 'config', configUpdated: false } }
      }
    }

    // ── analyze workspace ─────────────────────────────────────────────────────
    const analysis = await analyzeWorkspace(root)

    // ── detect action ─────────────────────────────────────────────────────────
    if (action === 'detect') {
      const existingMarkers = ['AGENTS.md', 'SOUL.md', 'TOOLS.md']
      const preview = [
        { file: 'AGENTS.md', exists: analysis.existingFiles.some(f => f.path === 'AGENTS.md'), reason: 'Project architecture, build commands, conventions' },
        { file: 'SOUL.md', exists: analysis.existingFiles.some(f => f.path === 'SOUL.md'), reason: 'Team culture, values, communication style' },
        { file: 'TOOLS.md', exists: analysis.existingFiles.some(f => f.path === 'TOOLS.md'), reason: 'Available tools and best practices' },
        { file: '~/.duckhive/config.json', exists: existsSync(resolve(DUCKHIVE_DIR, 'config.json')), reason: 'DuckHive settings (providers, models, features)' },
      ]
      return { data: { success: true, action: 'detect', preview } }
    }

    // ── setup action ───────────────────────────────────────────────────────────
    if (action === 'setup') {
      const filesCreated: string[] = []

      // Run deep analysis via sub-agent
      let deepAnalysis = ''
      try {
        deepAnalysis = await runDeepAnalysis(root)
      } catch (e) {
        deepAnalysis = `Analysis failed: ${e instanceof Error ? e.message : String(e)}`
      }

      // Create AGENTS.md
      const agentsPath = resolve(root, 'AGENTS.md')
      const agentsContent = buildAgentsMd(analysis, deepAnalysis, root)
      writeFileSync(agentsPath, agentsContent, 'utf8')
      filesCreated.push('AGENTS.md')

      // Create SOUL.md (only if not exists)
      const soulPath = resolve(root, 'SOUL.md')
      if (!existsSync(soulPath)) {
        writeFileSync(soulPath, buildSoulMd(), 'utf8')
        filesCreated.push('SOUL.md')
      } else {
        filesCreated.push('SOUL.md (skipped - already exists)')
      }

      // Create TOOLS.md
      const toolsPath = resolve(root, 'TOOLS.md')
      if (!existsSync(toolsPath)) {
        writeFileSync(toolsPath, buildToolsMd(), 'utf8')
        filesCreated.push('TOOLS.md')
      } else {
        filesCreated.push('TOOLS.md (skipped - already exists)')
      }

      // Create DuckHive config
      try {
        const { mkdirSync } = await import('fs')
        mkdirSync(DUCKHIVE_DIR, { recursive: true })
        writeFileSync(resolve(DUCKHIVE_DIR, 'config.json'), buildConfig(), 'utf8')
        filesCreated.push('~/.duckhive/config.json')
      } catch (e) {
        return { data: { success: false, action: 'setup', error: `Failed to create config: ${e instanceof Error ? e.message : String(e)}` } }
      }

      return { data: { success: true, action: 'setup', filesCreated } }
    }

    return { data: { success: false, action, error: `Unknown action: ${action}` } }
  },
} satisfies ToolDef<InputSchema, Output>)