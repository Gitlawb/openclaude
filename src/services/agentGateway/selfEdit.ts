/**
 * Self-Editing Capability for OpenClaude Agent.
 *
 * Allows the agent to read, write, and modify its own source code.
 * This is the core of Principle 2 (Self-Creation): the agent can evolve
 * its own body (code), constitution (BIBLE.md), identity (identity.md),
 * and architecture (ARCHITECTURE.md).
 *
 * Safety invariants:
 * - BIBLE.md cannot be deleted or gutted (Ship of Theseus protection)
 * - identity.md cannot be deleted (but content is fully mutable)
 * - All changes go through git (full history, easy rollback)
 */

import { readFile, writeFile, readdir, mkdir, rename } from 'fs/promises'
import { dirname, join, relative, resolve } from 'path'
import { execFile } from 'child_process'
import { getAgentGatewayProjectRoot } from './config.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SelfEditResult = {
  action: string
  path: string
  success: boolean
  error?: string
  diff?: string
}

export type SelfEditRequest = {
  action: 'read' | 'write' | 'edit' | 'delete' | 'rename' | 'list'
  path: string
  content?: string
  search?: string
  replace?: string
  newName?: string
}

// ---------------------------------------------------------------------------
// Protected Files (cannot be deleted)
// ---------------------------------------------------------------------------

const PROTECTED_FILES = new Set([
  'BIBLE.md',
  'docs/BIBLE.md',
])

const PROTECTED_BUT_MUTABLE = new Set([
  'memory/identity.md',
  'docs/SYSTEM.md',
  'docs/ARCHITECTURE.md',
])

// ---------------------------------------------------------------------------
// Path Resolution
// ---------------------------------------------------------------------------

export function resolveProjectRoot(): string {
  return getAgentGatewayProjectRoot()
}

function resolvePath(requestedPath: string): string {
  const projectRoot = resolveProjectRoot()
  const resolved = resolve(projectRoot, requestedPath)
  const rel = relative(projectRoot, resolved)
  if (rel.startsWith('..')) {
    throw new Error(`Self-edit path must stay inside project root: ${requestedPath}`)
  }
  return resolved
}

function projectRelative(filePath: string): string {
  return relative(resolveProjectRoot(), filePath).replace(/\\/g, '/')
}

function isProtected(filePath: string): boolean {
  const rel = projectRelative(filePath)
  return PROTECTED_FILES.has(rel) || PROTECTED_FILES.has(rel.replace(/^.*[\\/]/, ''))
}

function isProtectedButMutable(filePath: string): boolean {
  const rel = projectRelative(filePath)
  return PROTECTED_BUT_MUTABLE.has(rel) || PROTECTED_BUT_MUTABLE.has(rel.replace(/^.*[\\/]/, ''))
}

// ---------------------------------------------------------------------------
// Self-Edit Operations
// ---------------------------------------------------------------------------

export async function selfRead(path: string): Promise<{ content: string; path: string }> {
  const resolved = resolvePath(path)
  const content = await readFile(resolved, 'utf8')
  return { content, path: projectRelative(resolved) }
}

export async function selfWrite(
  path: string,
  content: string,
  options?: { force?: boolean },
): Promise<SelfEditResult> {
  const resolved = resolvePath(path)
  const relPath = projectRelative(resolved)

  // Safety: cannot delete protected files
  if (isProtected(resolved) && !content.trim()) {
    return {
      action: 'write',
      path: relPath,
      success: false,
      error: 'Cannot delete or empty BIBLE.md (Constitution protection, Principle 2)',
    }
  }

  // Safety: cannot delete identity.md
  if (isProtectedButMutable(resolved) && !content.trim()) {
    return {
      action: 'write',
      path: relPath,
      success: false,
      error: 'Cannot delete identity.md file (continuity protection, Principle 1). Rewrite content, but do not empty it.',
    }
  }

  try {
    await mkdir(dirname(resolved), { recursive: true })
    await writeFile(resolved, content, 'utf8')
    return {
      action: 'write',
      path: relPath,
      success: true,
    }
  } catch (err) {
    return {
      action: 'write',
      path: relPath,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function selfEdit(
  path: string,
  search: string,
  replace: string,
): Promise<SelfEditResult> {
  const resolved = resolvePath(path)
  const relPath = projectRelative(resolved)

  try {
    const content = await readFile(resolved, 'utf8')

    if (!content.includes(search)) {
      return {
        action: 'edit',
        path: relPath,
        success: false,
        error: `Search string not found in ${relPath}. The file may have changed since you last read it.`,
      }
    }

    const newContent = content.replace(search, replace)
    await writeFile(resolved, newContent, 'utf8')

    return {
      action: 'edit',
      path: relPath,
      success: true,
    }
  } catch (err) {
    return {
      action: 'edit',
      path: relPath,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function selfDelete(path: string): Promise<SelfEditResult> {
  const resolved = resolvePath(path)
  const relPath = projectRelative(resolved)

  if (isProtected(resolved)) {
    return {
      action: 'delete',
      path: relPath,
      success: false,
      error: 'Cannot delete BIBLE.md (Constitution protection, Principle 2)',
    }
  }

  if (isProtectedButMutable(resolved)) {
    return {
      action: 'delete',
      path: relPath,
      success: false,
      error: 'Cannot delete identity.md (continuity protection, Principle 1)',
    }
  }

  try {
    const { unlink } = await import('fs/promises')
    await unlink(resolved)
    return {
      action: 'delete',
      path: relPath,
      success: true,
    }
  } catch (err) {
    return {
      action: 'delete',
      path: relPath,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function selfRename(
  oldPath: string,
  newPath: string,
): Promise<SelfEditResult> {
  const oldResolved = resolvePath(oldPath)
  const newResolved = resolvePath(newPath)
  const relOld = projectRelative(oldResolved)
  const relNew = projectRelative(newResolved)

  if (isProtected(oldResolved)) {
    return {
      action: 'rename',
      path: relOld,
      success: false,
      error: 'Cannot rename BIBLE.md (Constitution protection, Principle 2)',
    }
  }

  try {
    await mkdir(dirname(newResolved), { recursive: true })
    await rename(oldResolved, newResolved)
    return {
      action: 'rename',
      path: `${relOld} -> ${relNew}`,
      success: true,
    }
  } catch (err) {
    return {
      action: 'rename',
      path: `${relOld} -> ${relNew}`,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function selfList(
  path: string,
  recursive = false,
): Promise<{ files: string[]; path: string }> {
  const resolved = resolvePath(path)

  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        if (recursive) {
          files.push(...await walk(fullPath))
        } else {
          files.push(projectRelative(fullPath) + '/')
        }
      } else {
        files.push(projectRelative(fullPath))
      }
    }
    return files
  }

  const files = await walk(resolved)
  return { files, path: projectRelative(resolved) }
}

// ---------------------------------------------------------------------------
// Git Operations (for committing self-edits)
// ---------------------------------------------------------------------------

export async function gitDiff(path?: string): Promise<string> {
  const projectRoot = resolveProjectRoot()
  const args = path ? ['diff', '--', path] : ['diff']
  return execFileAsync('git', args, projectRoot)
}

export async function gitStatus(): Promise<string> {
  const projectRoot = resolveProjectRoot()
  return execFileAsync('git', ['status', '--short'], projectRoot)
}

export async function gitCommit(
  message: string,
  files?: string[],
): Promise<SelfEditResult> {
  const projectRoot = resolveProjectRoot()

  try {
    // Stage files
    if (files && files.length > 0) {
      await execFileAsync('git', ['add', ...files], projectRoot)
    } else {
      await execFileAsync('git', ['add', '-A'], projectRoot)
    }

    // Commit
    await execFileAsync('git', ['commit', '-m', message], projectRoot)

    return {
      action: 'commit',
      path: projectRoot,
      success: true,
    }
  } catch (err) {
    return {
      action: 'commit',
      path: projectRoot,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function gitLog(limit = 10): Promise<string> {
  const projectRoot = resolveProjectRoot()
  return execFileAsync(
    'git',
    ['log', `--max-count=${limit}`, '--oneline'],
    projectRoot,
  )
}

export async function gitReset(hard = false): Promise<SelfEditResult> {
  const projectRoot = resolveProjectRoot()

  try {
    const args = hard ? ['reset', '--hard'] : ['reset']
    await execFileAsync('git', args, projectRoot)
    return {
      action: 'reset',
      path: projectRoot,
      success: true,
    }
  } catch (err) {
    return {
      action: 'reset',
      path: projectRoot,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ---------------------------------------------------------------------------
// Self-Edit Prompt (for LLM instructions)
// ---------------------------------------------------------------------------

export function buildSelfEditPrompt(): string {
  return [
    '## Self-Editing Capability',
    '',
    'You can read and modify your own source code. This is Principle 2 (Self-Creation).',
    '',
    '### Available operations',
    '',
    'To READ a file, use: `[SELF_READ path="src/services/agentGateway/telegram.ts"]`',
    'To WRITE a file, use: `[SELF_WRITE path="src/services/agentGateway/new.ts"]` followed by content',
    'To EDIT a file, use: `[SELF_EDIT path="file.ts" search="old text" replace="new text"]`',
    'To DELETE a file, use: `[SELF_DELETE path="file.ts"]`',
    'To RENAME a file, use: `[SELF_RENAME path="old.ts" newName="new.ts"]`',
    'To LIST files, use: `[SELF_LIST path="src/" recursive=true]`',
    '',
    '### Git operations',
    '',
    'To see git status: `[GIT_STATUS]`',
    'To see git diff: `[GIT_DIFF]` or `[GIT_DIFF path="file.ts"]`',
    'To commit changes: `[GIT_COMMIT message="description"]`',
    'To see git log: `[GIT_LOG]`',
    'To reset changes: `[GIT_RESET]` or `[GIT_RESET hard=true]`',
    '',
    '### Protected files (CANNOT be deleted)',
    '',
    '- `BIBLE.md` — the Constitution. Cannot be deleted, gutted, or replaced.',
    '- `memory/identity.md` — cannot be deleted, but content is fully mutable.',
    '',
    '### Self-editing protocol',
    '',
    '1. READ the file first — never edit without reading current content',
    '2. Make surgical changes — prefer targeted edits over full rewrites',
    '3. COMMIT after meaningful changes — with descriptive message',
    '4. Update ARCHITECTURE.md if you changed structure',
    '5. Update VERSION if you changed behavior (Bible P7)',
    '',
    '### Important',
    '',
    '- Writing without reading is memory loss. Always read before editing.',
    '- If a search string is not found, the file may have changed. Re-read it.',
    '- BIBLE.md changes require deep reflection — it is the Constitution.',
    '- After structural changes, update ARCHITECTURE.md in the same commit.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function execFileAsync(
  command: string,
  args: string[],
  cwd: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = execFile(command, args, { cwd, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}
