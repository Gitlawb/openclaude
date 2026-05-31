import { readFileSync } from 'fs'
import {
  setAllowedSettingSources,
  setFlagSettingsPath,
} from '../../bootstrap/state.js'
import { eagerParseCliFlag } from '../cliArgs.js'
import { errorMessage, isENOENT } from '../errors.js'
import { getFsImplementation, safeResolvePath } from '../fsOperations.js'
import { safeParseJSON } from '../json.js'
import { writeFileSync_DEPRECATED } from '../slowOperations.js'
import { generateTempFilePath } from '../tempfile.js'
import { parseSettingSourcesFlag } from './constants.js'
import { resetSettingsCache } from './settingsCache.js'

export type EagerLoadSettingsFromArgsResult =
  | { ok: true }
  | { ok: false; message: string; cause?: unknown }

/**
 * Parse and install settings-related CLI flags before the full Commander
 * startup path runs.
 *
 * This is needed by bootstrap paths that inspect getInitialSettings() before
 * main.tsx is imported, including out-of-process teammate provider routing.
 */
export function eagerLoadSettingsFromArgs(
  argv: string[] = process.argv,
): EagerLoadSettingsFromArgsResult {
  const settingsFile = eagerParseCliFlag('--settings', argv)
  if (settingsFile) {
    const settingsResult = loadSettingsFromFlag(settingsFile)
    if (!settingsResult.ok) return settingsResult
  }

  const settingSourcesArg = eagerParseCliFlag('--setting-sources', argv)
  if (settingSourcesArg !== undefined) {
    const sourcesResult = loadSettingSourcesFromFlag(settingSourcesArg)
    if (!sourcesResult.ok) return sourcesResult
  }

  return { ok: true }
}

function loadSettingsFromFlag(
  settingsFile: string,
): EagerLoadSettingsFromArgsResult {
  try {
    const trimmedSettings = settingsFile.trim()
    const looksLikeJson =
      trimmedSettings.startsWith('{') && trimmedSettings.endsWith('}')
    let settingsPath: string
    if (looksLikeJson) {
      const parsedJson = safeParseJSON(trimmedSettings)
      if (!parsedJson) {
        return {
          ok: false,
          message: 'Error: Invalid JSON provided to --settings',
        }
      }

      // Use a content-hash-based temp path so identical inline settings keep
      // stable sandbox/tool descriptions across spawned subprocesses.
      settingsPath = generateTempFilePath('claude-settings', '.json', {
        contentHash: trimmedSettings,
      })
      writeFileSync_DEPRECATED(settingsPath, trimmedSettings, 'utf8')
    } else {
      const { resolvedPath: resolvedSettingsPath } = safeResolvePath(
        getFsImplementation(),
        settingsFile,
      )
      try {
        readFileSync(resolvedSettingsPath, 'utf8')
      } catch (e) {
        if (isENOENT(e)) {
          return {
            ok: false,
            message: `Error: Settings file not found: ${resolvedSettingsPath}`,
          }
        }
        throw e
      }
      settingsPath = resolvedSettingsPath
    }
    setFlagSettingsPath(settingsPath)
    resetSettingsCache()
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message: `Error processing settings: ${errorMessage(error)}`,
      cause: error,
    }
  }
}

function loadSettingSourcesFromFlag(
  settingSourcesArg: string,
): EagerLoadSettingsFromArgsResult {
  try {
    const sources = parseSettingSourcesFlag(settingSourcesArg)
    setAllowedSettingSources(sources)
    resetSettingsCache()
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message: `Error processing --setting-sources: ${errorMessage(error)}`,
      cause: error,
    }
  }
}
