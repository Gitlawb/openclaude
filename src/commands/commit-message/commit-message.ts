import type { LocalCommandCall } from '../../types/command.js'
import { getAttributionTexts } from '../../utils/attribution.js'
import { settingsChangeDetector } from '../../utils/settings/changeDetector.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'

type ParsedCoAuthor = {
  name: string
  email: string
}

export const USAGE = [
  'Commit message attribution',
  'Controls only the attribution text appended after /commit messages.',
  'It does not set the commit title or summary.',
  '',
  'Usage:',
  '  /commit-message status',
  '  /commit-message off',
  '  /commit-message default',
  '  /commit-message set "Generated with OpenClaude using GPT-5.5"',
  '  /commit-message co-author "Name" name@example.com',
].join('\n')

function sanitizeSingleLine(value: string): string {
  return value
    .replace(/[\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2) return trimmed
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function formatCoAuthorTrailer(name: string, email: string): string {
  const cleanName = sanitizeSingleLine(name).replace(/[<>]/g, '')
  const cleanEmail = sanitizeSingleLine(email).replace(/[<>]/g, '')
  return `Co-Authored-By: ${cleanName} <${cleanEmail}>`
}

export function parseCoAuthor(value: string): ParsedCoAuthor | null {
  const trimmed = value.trim()
  const angleMatch = trimmed.match(
    /^(?:"([^"]+)"|'([^']+)'|(.+?))\s*<([^<>\s]+@[^<>\s]+)>$/,
  )
  if (angleMatch) {
    const name = sanitizeSingleLine(
      angleMatch[1] ?? angleMatch[2] ?? angleMatch[3] ?? '',
    )
    const email = sanitizeSingleLine(angleMatch[4] ?? '')
    if (!name || !email) return null
    return {
      name,
      email,
    }
  }

  const plainMatch = trimmed.match(
    /^(?:"([^"]+)"|'([^']+)'|(.+?))\s+([^<>\s]+@[^<>\s]+)$/,
  )
  if (!plainMatch) return null

  const name = sanitizeSingleLine(
    plainMatch[1] ?? plainMatch[2] ?? plainMatch[3] ?? '',
  )
  const email = sanitizeSingleLine(plainMatch[4] ?? '')
  if (!name || !email) return null

  return {
    name,
    email,
  }
}

function saveCommitAttribution(commit: string | undefined): string | null {
  const result = updateSettingsForSource('userSettings', {
    attribution: { commit },
  })
  if (result.error) {
    return 'Failed to update user settings. Check your settings file for syntax errors.'
  }
  settingsChangeDetector.notifyChange('userSettings')
  return null
}

function formatStatus(): string {
  const effective = getAttributionTexts().commit
  const configured = getInitialSettings().attribution?.commit
  const configuredText =
    configured === undefined
      ? 'default'
      : configured === ''
        ? 'off'
        : configured

  return [
    'Commit message attribution',
    `Configured: ${configuredText}`,
    `Effective: ${effective || 'off'}`,
  ].join('\n')
}

export const call: LocalCommandCall = async args => {
  const raw = args.trim()
  if (!raw || raw === 'status') {
    return { type: 'text', value: `${formatStatus()}\n\n${USAGE}` }
  }

  const [command = '', ...rest] = raw.split(/\s+/)
  const commandArg = rest.join(' ').trim()

  switch (command.toLowerCase()) {
    case 'off':
    case 'none':
    case 'disable': {
      const error = saveCommitAttribution('')
      if (error) return { type: 'text', value: error }
      return {
        type: 'text',
        value: 'Commit attribution disabled for future /commit messages.',
      }
    }

    case 'default':
    case 'reset':
    case 'on': {
      const error = saveCommitAttribution(undefined)
      if (error) return { type: 'text', value: error }
      return {
        type: 'text',
        value: 'Commit attribution reset to the OpenClaude default.',
      }
    }

    case 'set-attribution':
    case 'set':
    case 'custom': {
      const value = stripMatchingQuotes(commandArg)
      if (!value) return { type: 'text', value: USAGE }
      const error = saveCommitAttribution(value)
      if (error) return { type: 'text', value: error }
      return {
        type: 'text',
        value: `Commit attribution text appended by /commit set to:\n${value}`,
      }
    }

    case 'co-author':
    case 'coauthor': {
      const parsed = parseCoAuthor(commandArg)
      if (!parsed) return { type: 'text', value: USAGE }
      const trailer = formatCoAuthorTrailer(parsed.name, parsed.email)
      const error = saveCommitAttribution(trailer)
      if (error) return { type: 'text', value: error }
      return {
        type: 'text',
        value: `Commit co-author set to:\n${trailer}`,
      }
    }
  }

  return { type: 'text', value: USAGE }
}
