import { feature } from 'bun:bundle'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { logEvent } from '../../services/analytics/index.js'
import {
  checkSemantics,
  parseForSecurityFromAst,
  type ParseForSecurityResult,
  type Redirect,
  type SimpleCommand,
} from '../../utils/bash/ast.js'
import { splitCommand_DEPRECATED } from '../../utils/bash/commands.js'
import {
  PARSE_ABORTED,
  parseCommandRaw,
  type Node,
} from '../../utils/bash/parser.js'
import {
  type ParseEntry,
  type ShellParseFailureKind,
  type ShellParseFailureReasonCode,
  tryParseShellCommand,
} from '../../utils/bash/shellQuote.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

const splitCommand = splitCommand_DEPRECATED

export type LegacyShellParseAnalysis =
  | { kind: 'not-run' }
  | { kind: 'ok'; tokens: ParseEntry[] }
  | {
      kind: 'failed'
      error: string
      failureKind: ShellParseFailureKind
      reasonCode: ShellParseFailureReasonCode
    }

export type BashCommandAnalysis = {
  command: string
  injectionCheckDisabled: boolean
  shadowEnabled: boolean
  astRoot: Node | null | typeof PARSE_ABORTED
  astResult: ParseForSecurityResult
  astSubcommands: string[] | null
  astRedirects?: Redirect[]
  astCommands?: SimpleCommand[]
  shadowLegacySubs?: string[]
  legacyParse: LegacyShellParseAnalysis
}

const loggedParserLimitations = new WeakSet<BashCommandAnalysis>()

export function parseLegacyShellCommandForAnalysis(
  command: string,
): LegacyShellParseAnalysis {
  const parseResult = tryParseShellCommand(command, env => `$${env}`)
  if (parseResult.success) {
    return { kind: 'ok', tokens: parseResult.tokens }
  }
  return {
    kind: 'failed',
    error: parseResult.error,
    failureKind: parseResult.failureKind,
    reasonCode: parseResult.reasonCode,
  }
}

export async function analyzeBashCommand(
  command: string,
): Promise<BashCommandAnalysis> {
  const injectionCheckDisabled = isEnvTruthy(
    process.env.CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK,
  )
  const shadowEnabled = feature('TREE_SITTER_BASH_SHADOW')
    ? getFeatureValue_CACHED_MAY_BE_STALE('tengu_birch_trellis', true)
    : false

  let astRoot: Node | null | typeof PARSE_ABORTED = injectionCheckDisabled
    ? null
    : feature('TREE_SITTER_BASH_SHADOW') && !shadowEnabled
      ? null
      : await parseCommandRaw(command)

  let astResult: ParseForSecurityResult = astRoot
    ? parseForSecurityFromAst(command, astRoot)
    : { kind: 'parse-unavailable' }
  let astSubcommands: string[] | null = null
  let astRedirects: Redirect[] | undefined
  let astCommands: SimpleCommand[] | undefined
  let shadowLegacySubs: string[] | undefined

  if (feature('TREE_SITTER_BASH_SHADOW')) {
    const available = astResult.kind !== 'parse-unavailable'
    let tooComplex = false
    let semanticFail = false
    let subsDiffer = false
    if (available) {
      tooComplex = astResult.kind === 'too-complex'
      semanticFail =
        astResult.kind === 'simple' && !checkSemantics(astResult.commands).ok
      const tsSubs =
        astResult.kind === 'simple'
          ? astResult.commands.map(c => c.text)
          : undefined
      const legacySubs = splitCommand(command)
      shadowLegacySubs = legacySubs
      subsDiffer =
        tsSubs !== undefined &&
        (tsSubs.length !== legacySubs.length ||
          tsSubs.some((s, i) => s !== legacySubs[i]))
    }
    logEvent('tengu_tree_sitter_shadow', {
      available,
      astTooComplex: tooComplex,
      astSemanticFail: semanticFail,
      subsDiffer,
      injectionCheckDisabled,
      killswitchOff: !shadowEnabled,
      cmdOverLength: command.length > 10000,
    })
    astResult = { kind: 'parse-unavailable' }
    astRoot = null
  }

  if (astResult.kind === 'simple') {
    astSubcommands = astResult.commands.map(c => c.text)
    astRedirects = astResult.commands.flatMap(c => c.redirects)
    astCommands = astResult.commands
  }

  const legacyParse =
    astResult.kind === 'parse-unavailable'
      ? parseLegacyShellCommandForAnalysis(command)
      : { kind: 'not-run' as const }

  return {
    command,
    injectionCheckDisabled,
    shadowEnabled,
    astRoot,
    astResult,
    astSubcommands,
    astRedirects,
    astCommands,
    shadowLegacySubs,
    legacyParse,
  }
}

export function logLegacyParserLimitationOnce(
  analysis: BashCommandAnalysis,
): void {
  if (
    analysis.legacyParse.kind !== 'failed' ||
    analysis.legacyParse.failureKind !== 'expected-limitation' ||
    loggedParserLimitations.has(analysis)
  ) {
    return
  }

  loggedParserLimitations.add(analysis)
  logForDebugging(
    `bashCommandAnalysis: legacy parser limitation reason=${analysis.legacyParse.reasonCode}`,
    { level: 'debug' },
  )
}
