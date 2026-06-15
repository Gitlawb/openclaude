import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import command from './index.js'

// Regression for the "/<anything> freezes on /simplify" bug: building the
// command search index renders every command's description, and this command's
// `get description()` reads SandboxManager.checkDependencies().errors. When
// checkDependencies() returned null at runtime, `.errors` threw, which rejected
// the whole suggestion update and froze the slash-command dropdown.
describe('sandbox command description getter', () => {
  afterEach(() => {
    // Restore every spy created via spyOn so state doesn't leak between tests.
    // (spyOn is used instead of mock.module, which leaks across files.)
    spyOn(SandboxManager, 'checkDependencies').mockRestore()
    spyOn(SandboxManager, 'isSandboxingEnabled').mockRestore()
    spyOn(SandboxManager, 'isAutoAllowBashIfSandboxedEnabled').mockRestore()
    spyOn(SandboxManager, 'areUnsandboxedCommandsAllowed').mockRestore()
    spyOn(SandboxManager, 'areSandboxSettingsLockedByPolicy').mockRestore()
  })

  function stubManager(): void {
    spyOn(SandboxManager, 'isSandboxingEnabled').mockReturnValue(false)
    spyOn(SandboxManager, 'isAutoAllowBashIfSandboxedEnabled').mockReturnValue(
      false,
    )
    spyOn(SandboxManager, 'areUnsandboxedCommandsAllowed').mockReturnValue(false)
    spyOn(SandboxManager, 'areSandboxSettingsLockedByPolicy').mockReturnValue(
      false,
    )
  }

  test('does not throw when checkDependencies() returns null', () => {
    stubManager()
    spyOn(SandboxManager, 'checkDependencies').mockReturnValue(
      null as unknown as ReturnType<typeof SandboxManager.checkDependencies>,
    )

    let description: string | undefined
    expect(() => {
      description = command.description
    }).not.toThrow()
    expect(typeof description).toBe('string')
  })

  test('renders normally when dependencies are present', () => {
    stubManager()
    spyOn(SandboxManager, 'checkDependencies').mockReturnValue({
      errors: [],
      warnings: [],
    } as unknown as ReturnType<typeof SandboxManager.checkDependencies>)

    expect(command.description).toContain('sandbox')
  })

  test('reflects missing dependencies without throwing', () => {
    stubManager()
    spyOn(SandboxManager, 'checkDependencies').mockReturnValue({
      errors: ['missing ripgrep'],
      warnings: [],
    } as unknown as ReturnType<typeof SandboxManager.checkDependencies>)

    expect(typeof command.description).toBe('string')
  })
})
