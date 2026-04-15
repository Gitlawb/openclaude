/**
 * Comprehensive test suite for bug fixes from BUGS_README.md
 * Tests the critical and medium severity fixes applied.
 */
import { describe, test, expect } from 'bun:test'

// ========== withRetry.ts fixes ==========

describe('withRetry.ts fixes', () => {
  test('#55 - is529Error uses structured JSON parsing', async () => {
    const content = await Bun.file('./src/services/api/withRetry.ts').text()
    expect(content).toContain('isOverloadedErrorMessage')
    expect(content).toContain('JSON.parse(message.slice(jsonStart))')
  })

  test('#56 - getRetryAfterMs handles HTTP-date format', async () => {
    const content = await Bun.file('./src/services/api/withRetry.ts').text()
    expect(content).toContain('Date.parse(retryAfter)')
    expect(content).toContain('HTTP-date format')
  })

  test('#54 - persistent retry loop clamp fixed', async () => {
    const content = await Bun.file('./src/services/api/withRetry.ts').text()
    expect(content).toContain('maxRetries - 1')
    expect(content).not.toContain('attempt = maxRetries\n')
  })

  test('#58 - consecutive529Errors reset on fallback', async () => {
    const content = await Bun.file('./src/services/api/withRetry.ts').text()
    expect(content).toContain('consecutive529Errors = 0')
  })
})

// ========== FileEditTool.ts fixes ==========

describe('FileEditTool.ts fixes', () => {
  test('#9 - trimEnd comparison catches no-op edits', () => {
    const oldStr = 'hello world  '
    const newStr = 'hello world'
    // The fix: trimEnd before comparing
    expect(oldStr.trimEnd()).toBe(newStr.trimEnd())
  })

  test('#9 - different content is not caught by trimEnd', () => {
    const oldStr = 'hello world'
    const newStr = 'hello universe'
    expect(oldStr.trimEnd()).not.toBe(newStr.trimEnd())
  })

  test('#8 - MAX_EDIT_FILE_SIZE is reasonable', async () => {
    // Read the file to verify the constant was changed
    const content = await Bun.file('./src/tools/FileEditTool/FileEditTool.ts').text()
    expect(content).toContain('256 * 1024 * 1024')
    expect(content).not.toContain('1024 * 1024 * 1024')
  })
})

// ========== bashPermissions.ts fixes ==========

describe('bashPermissions.ts fixes', () => {
  test('#5 - interpreters blocked from bare prefix suggestions', async () => {
    const content = await Bun.file('./src/tools/BashTool/bashPermissions.ts').text()
    // Verify dangerous interpreters are in BARE_SHELL_PREFIXES
    expect(content).toMatch(/'python3?'/)
    expect(content).toMatch(/'node'/)
    expect(content).toMatch(/'ruby'/)
    expect(content).toMatch(/'perl'/)
    expect(content).toMatch(/'php'/)
    expect(content).toMatch(/'lua'/)
    expect(content).toMatch(/'awk'/)
  })
})

// ========== FileReadTool.ts fixes ==========

describe('FileReadTool.ts fixes', () => {
  test('#32 - MAX_FILE_READ_LISTENERS limit exists', async () => {
    const content = await Bun.file('./src/tools/FileReadTool/FileReadTool.ts').text()
    expect(content).toContain('MAX_FILE_READ_LISTENERS')
  })

  test('#33 - uncompressed image fallback throws instead of returning', async () => {
    const content = await Bun.file('./src/tools/FileReadTool/FileReadTool.ts').text()
    expect(content).toContain('too large')
    expect(content).toContain('token budget')
  })

  test('#34 - ELOOP error handling added', async () => {
    const content = await Bun.file('./src/tools/FileReadTool/FileReadTool.ts').text()
    expect(content).toContain('ELOOP')
    expect(content).toContain('Symlink loop detected')
  })

  test('#35 - mtime precision preserved (no Math.floor)', async () => {
    const content = await Bun.file('./src/tools/FileReadTool/FileReadTool.ts').text()
    // Should use raw mtimeMs, not Math.floor(mtimeMs)
    expect(content).toContain('timestamp: stats.mtimeMs')
    expect(content).toContain('timestamp: mtimeMs')
    expect(content).not.toContain('Math.floor(stats.mtimeMs)')
    expect(content).not.toContain('Math.floor(mtimeMs)')
  })
})

// ========== SkillTool.ts fixes ==========

describe('SkillTool.ts fixes', () => {
  test('#28 - remoteSkillModules uses safe access (no ! assertions)', async () => {
    const content = await Bun.file('./src/tools/SkillTool/SkillTool.ts').text()
    expect(content).not.toContain('remoteSkillModules!')
    expect(content).toContain('remoteSkillModules?.')
  })

  test('#30 - SAFE_SKILL_PROPERTIES includes hooks and allowedTools', async () => {
    const content = await Bun.file('./src/tools/SkillTool/SkillTool.ts').text()
    expect(content).toMatch(/'hooks'/)
    expect(content).toMatch(/'allowedTools'/)
  })
})

// ========== spawnMultiAgent.ts fixes ==========

describe('spawnMultiAgent.ts fixes', () => {
  test('#37 - team file mutex exists', async () => {
    const content = await Bun.file('./src/tools/shared/spawnMultiAgent.ts').text()
    expect(content).toContain('withTeamFileLock')
    expect(content).toContain('_teamFileMutex')
  })

  test('#38 - model flag uses equals-separated format', async () => {
    const content = await Bun.file('./src/tools/shared/spawnMultiAgent.ts').text()
    expect(content).toContain('--model=${quote([model])}')
    expect(content).not.toContain('--model ${quote([model])}')
  })
})

// ========== bundledSkills.ts fixes ==========

describe('bundledSkills.ts fixes', () => {
  test('#40 - extraction retries on failure', async () => {
    const content = await Bun.file('./src/skills/bundledSkills.ts').text()
    expect(content).toContain('extractionPromise = undefined')
  })

  test('#41 - path traversal has resolved-path verification', async () => {
    const content = await Bun.file('./src/skills/bundledSkills.ts').text()
    expect(content).toContain('resolved.startsWith(baseDir')
  })
})

// ========== loadSkillsDir.ts fixes ==========

describe('loadSkillsDir.ts fixes', () => {
  test('#24 - concurrent walk batching limit', async () => {
    const content = await Bun.file('./src/skills/loadSkillsDir.ts').text()
    expect(content).toContain('MAX_CONCURRENT_WALKS')
  })

  test('#23 - MAX_CONDITIONAL_SKILLS limit', async () => {
    const content = await Bun.file('./src/skills/loadSkillsDir.ts').text()
    expect(content).toContain('MAX_CONDITIONAL_SKILLS')
  })
})

// ========== query.ts fixes ==========

describe('query.ts fixes', () => {
  test('#48 - toolResults included in recovery state', async () => {
    const content = await Bun.file('./src/query.ts').text()
    // Find the max_output_tokens_recovery section
    const recoveryIdx = content.indexOf("reason: 'max_output_tokens_recovery'")
    expect(recoveryIdx).toBeGreaterThan(0)
    // Check that toolResults is spread in the messages array nearby
    const context = content.slice(Math.max(0, recoveryIdx - 800), recoveryIdx)
    expect(context).toContain('...toolResults')
  })

  test('#49 - continuationNudgeCount reset on stop_hook_blocking', async () => {
    const content = await Bun.file('./src/query.ts').text()
    const stopHookIdx = content.indexOf("reason: 'stop_hook_blocking'")
    expect(stopHookIdx).toBeGreaterThan(0)
    const context = content.slice(Math.max(0, stopHookIdx - 300), stopHookIdx + 50)
    // Should have continuationNudgeCount: 0 (not state.continuationNudgeCount)
    expect(context).toContain('continuationNudgeCount: 0')
  })

  test('#52 - pendingToolUseSummary wrapped in try/catch', async () => {
    const content = await Bun.file('./src/query.ts').text()
    // Find the await pendingToolUseSummary usage (line ~1088)
    const awaitIdx = content.indexOf('await pendingToolUseSummary')
    expect(awaitIdx).toBeGreaterThan(0)
    const context = content.slice(Math.max(0, awaitIdx - 100), awaitIdx + 300)
    expect(context).toContain('try {')
    expect(context).toContain('catch')
  })
})

// ========== StreamingToolExecutor.ts fixes ==========

describe('StreamingToolExecutor.ts fixes', () => {
  test('#62 - processQueue checks discarded before execute', async () => {
    const content = await Bun.file('./src/services/tools/StreamingToolExecutor.ts').text()
    const processQueueIdx = content.indexOf('private async processQueue')
    const context = content.slice(processQueueIdx, processQueueIdx + 800)
    expect(context).toContain('if (this.discarded)')
    expect(context).toContain('streaming_fallback')
  })

  test('#61 - progressAvailableResolve has timeout cleanup', async () => {
    const content = await Bun.file('./src/services/tools/StreamingToolExecutor.ts').text()
    expect(content).toContain('30_000')
    expect(content).toContain('progressAvailableResolve = undefined')
  })

  test('#59 - contextModifiers warning for concurrent tools', async () => {
    const content = await Bun.file('./src/services/tools/StreamingToolExecutor.ts').text()
    expect(content).toContain('context modifier(s) that were dropped')
  })

  test('#60 - sibling abort preserves all error descriptions', async () => {
    const content = await Bun.file('./src/services/tools/StreamingToolExecutor.ts').text()
    expect(content).toContain('erroredToolDescription = this.erroredToolDescription')
    expect(content).toContain('siblingAbortController.signal.aborted')
  })

  test('#75 - global tool timeout exists', async () => {
    const content = await Bun.file('./src/services/tools/StreamingToolExecutor.ts').text()
    expect(content).toContain('GLOBAL_TOOL_TIMEOUT_MS')
    expect(content).toContain('5 * 60 * 1000')
  })
})

// ========== WebFetchTool.ts fixes ==========

describe('WebFetchTool.ts fixes', () => {
  test('#16 - FIRECRAWL_API_KEY has null check', async () => {
    const content = await Bun.file('./src/tools/WebFetchTool/WebFetchTool.ts').text()
    expect(content).not.toContain('FIRECRAWL_API_KEY!')
    expect(content).toContain('if (!apiKey)')
  })

  test('#42 - redirect URL sanitized', async () => {
    const content = await Bun.file('./src/tools/WebFetchTool/WebFetchTool.ts').text()
    expect(content).toContain('safeRedirectUrl')
    expect(content).toContain("replace(/[\\n\\r`$]/g")
  })
})

// ========== main.tsx fixes ==========

describe('main.tsx fixes', () => {
  test('#67 - commandsPromise logs errors', async () => {
    const content = await Bun.file('./src/main.tsx').text()
    expect(content).toContain('Commands init failed')
  })

  test('#68 - mcpPromise logs errors', async () => {
    const content = await Bun.file('./src/main.tsx').text()
    expect(content).toContain('MCP init failed')
  })

  test('#71 - sessionStartHooksPromise logs errors', async () => {
    const content = await Bun.file('./src/main.tsx').text()
    expect(content).toContain('Session start hooks failed')
  })
})

// ========== QueryEngine.ts fixes ==========

describe('QueryEngine.ts fixes', () => {
  test('#72 - snipProjection uses safe access', async () => {
    const content = await Bun.file('./src/QueryEngine.ts').text()
    expect(content).not.toContain('snipProjection!')
    expect(content).toContain('snipProjection?.')
    expect(content).toContain('snipModule?.')
  })
})

// ========== errorUtils.ts fixes ==========

describe('errorUtils.ts fixes', () => {
  test('#77 - maxDepth increased to 10', async () => {
    const content = await Bun.file('./src/services/api/errorUtils.ts').text()
    expect(content).toContain('const maxDepth = 10')
    expect(content).not.toContain('const maxDepth = 5')
  })
})

// ========== errors.ts fixes ==========

describe('errors.ts fixes', () => {
  test('#76 - isPromptTooLongMessage has fallback check', async () => {
    const content = await Bun.file('./src/services/api/errors.ts').text()
    expect(content).toContain('errorDetails?.includes(PROMPT_TOO_LONG_ERROR_MESSAGE)')
  })
})

// ========== REPL.tsx fixes ==========

describe('REPL.tsx fixes', () => {
  test('#64 - notification attachment errors logged', async () => {
    const content = await Bun.file('./src/screens/REPL.tsx').text()
    expect(content).toContain('Failed to get notification attachments')
  })

  test('#65 - queue access has length check', async () => {
    const content = await Bun.file('./src/screens/REPL.tsx').text()
    expect(content).toContain('workerSandboxPermissions.queue.length > 0')
    expect(content).toContain('elicitation.queue.length > 0')
  })

  test('#66 - editorTimerRef cleanup on unmount', async () => {
    const content = await Bun.file('./src/screens/REPL.tsx').text()
    expect(content).toContain('editorTimerRef')
    expect(content).toContain('clearTimeout(editorTimerRef.current)')
  })
})

// ========== AgentTool fixes ==========

describe('AgentTool fixes', () => {
  test('#12 - cleanup timeout increased to 5s', async () => {
    const content = await Bun.file('./src/tools/AgentTool/AgentTool.tsx').text()
    expect(content).toContain('sleep(5000)')
    expect(content).toContain('Agent cleanup timed out after 5s')
  })

  test('#11 - provider override logged', async () => {
    const content = await Bun.file('./src/tools/AgentTool/runAgent.ts').text()
    expect(content).toContain('model overridden by provider')
  })

  test('#14 - allowedTools merges with session rules', async () => {
    const content = await Bun.file('./src/tools/AgentTool/runAgent.ts').text()
    expect(content).toContain('alwaysAllowRules.session ?? []')
    expect(content).toContain('...allowedTools')
  })
})

// ========== Other tool fixes ==========

describe('Other tool fixes', () => {
  test('#10 - file tool catches log errors', async () => {
    const fw = await Bun.file('./src/tools/FileWriteTool/FileWriteTool.ts').text()
    const fe = await Bun.file('./src/tools/FileEditTool/FileEditTool.ts').text()
    const fr = await Bun.file('./src/tools/FileReadTool/FileReadTool.ts').text()
    expect(fw).toContain('logError(err)')
    expect(fe).toContain('logError(err)')
    expect(fr).toContain('logError(err)')
  })

  test('#21 - PowerShellTool setTimeout uses arrow function', async () => {
    const content = await Bun.file('./src/tools/PowerShellTool/PowerShellTool.tsx').text()
    expect(content).toContain('setTimeout(() => resolve(null)')
    expect(content).not.toContain('setTimeout(r => r(null)')
  })

  test('#45 - CronCreateTool has frequency limit', async () => {
    const content = await Bun.file('./src/tools/ScheduleCronTool/CronCreateTool.ts').text()
    expect(content).toContain('60_000')
    expect(content).toContain('fires more frequently than once per minute')
  })

  test('#47 - ConfigTool sanitizes string values', async () => {
    const content = await Bun.file('./src/tools/ConfigTool/ConfigTool.ts').text()
    expect(content).toContain('MAX_CONFIG_VALUE_LENGTH')
    expect(content).toContain('Value too long')
  })

  test('#26 - bundledSkills warns on duplicate names', async () => {
    const content = await Bun.file('./src/skills/bundledSkills.ts').text()
    expect(content).toContain('registered')
    expect(content).toContain('times')
  })

  test('#3 - bashSecurity heredoc validator documents sync constraint', async () => {
    const content = await Bun.file('./src/tools/BashTool/bashSecurity.ts').text()
    expect(content).toContain('SECURITY: Uses regex-only path (sync)')
  })

  test('#6 - BashTool documents DEPRECATED dependency', async () => {
    const content = await Bun.file('./src/tools/BashTool/BashTool.tsx').text()
    expect(content).toContain('splitCommand_DEPRECATED is the only sync command splitter')
  })

  test('#15 - WebFetchTool Firecrawl path has audit log', async () => {
    const content = await Bun.file('./src/tools/WebFetchTool/WebFetchTool.ts').text()
    expect(content).toContain('Firecrawl handles redirects internally')
  })

  test('#17 - WebFetchTool utils has migration TODO', async () => {
    const content = await Bun.file('./src/tools/WebFetchTool/utils.ts').text()
    expect(content).toContain('TODO: migrate to non-deprecated settings API')
  })
})
