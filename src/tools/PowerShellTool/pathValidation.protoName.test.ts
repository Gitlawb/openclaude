import { describe, expect, test } from 'bun:test'
import type { ToolPermissionContext } from '../../types/permissions.js'
import type { ParsedPowerShellCommand } from '../../utils/powershell/parser.js'
import { checkPathConstraints } from './pathValidation.js'

function defaultContext(): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  }
}

// Build a parsed command with a single cmdlet whose name we control. The real
// PowerShell AST parser requires a pwsh binary, so the parsed structure is
// constructed directly — the defect under test is in the CMDLET_PATH_CONFIG
// lookup keyed by the cmdlet name, downstream of parsing. A PowerShell command
// like `constructor -Path C:\x` parses to a command named `constructor` on a
// machine with pwsh installed.
function parsedCommandNamed(name: string): ParsedPowerShellCommand {
  const command = `${name} -Path C:\\temp\\file.txt`
  return {
    valid: true,
    errors: [],
    variables: [],
    hasStopParsing: false,
    originalCommand: command,
    statements: [
      {
        statementType: 'PipelineAst',
        text: command,
        redirections: [],
        commands: [
          {
            name,
            nameType: 'cmdlet',
            elementType: 'CommandAst',
            args: ['-Path', 'C:\\temp\\file.txt'],
            text: command,
            elementTypes: ['StringConstantExpressionAst', 'CommandParameterAst'],
          },
        ],
      },
    ],
  } as unknown as ParsedPowerShellCommand
}

// CMDLET_PATH_CONFIG is keyed by the (lowercased) cmdlet name. A command whose
// name collides with an inherited Object.prototype member must resolve to no
// config (unknown-cmdlet passthrough), not the inherited prototype value. Before
// the null-proto fix the lookup returned a truthy inherited member, so
// `[...config.knownSwitches]` threw (spread of undefined) and crashed
// path-constraint validation. `constructor` and `__proto__` below are
// representative all-lowercase collisions reachable through the lowercased key;
// the null-prototype container neutralizes every inherited-key lookup, not just
// these two.
describe('checkPathConstraints with prototype-polluting cmdlet names', () => {
  test.each(['constructor', '__proto__'])(
    'treats %s as an unknown cmdlet instead of crashing',
    (name) => {
      const parsed = parsedCommandNamed(name)
      expect(() =>
        checkPathConstraints(
          { command: parsed.originalCommand },
          parsed,
          defaultContext(),
        ),
      ).not.toThrow()
      const result = checkPathConstraints(
        { command: parsed.originalCommand },
        parsed,
        defaultContext(),
      )
      expect(result.behavior).toBe('passthrough')
    },
  )

  test('a real path cmdlet is still classified (control)', () => {
    const parsed = parsedCommandNamed('set-content')
    // set-content is a known write cmdlet, so its config is found and the
    // lookup does not fall through to the unknown-cmdlet branch — proves the
    // null-proto container still holds and resolves its own entries. Its
    // parameterized `-Path` cannot be statically validated, so the classified
    // decision is `ask` rather than the `passthrough` returned for the
    // prototype-key names above.
    const result = checkPathConstraints(
      { command: parsed.originalCommand },
      parsed,
      defaultContext(),
    )
    expect(result.behavior).toBe('ask')
  })
})
