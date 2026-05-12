import type { Command } from '../../types/command.js'
import { getCommandName } from '../../types/command.js'
import { logForDebugging } from '../debug.js'

function isPluginAliasCommand(command: Command): boolean {
  return (
    command.type === 'prompt' &&
    command.source === 'plugin' &&
    command.loadedFrom === 'plugin'
  )
}

function commandNames(command: Command): string[] {
  const visibleName = getCommandName(command)
  return visibleName === command.name
    ? [command.name]
    : [command.name, visibleName]
}

export function removeCollidingPluginAliases(commands: Command[]): Command[] {
  const reservedNames = new Set(
    commands.flatMap(command =>
      isPluginAliasCommand(command)
        ? commandNames(command)
        : [...commandNames(command), ...(command.aliases ?? [])],
    ),
  )
  const claimedAliases = new Set<string>()

  return commands.map(command => {
    if (!command.aliases || command.aliases.length === 0) {
      return command
    }

    if (!isPluginAliasCommand(command)) {
      for (const alias of command.aliases) {
        claimedAliases.add(alias)
      }
      return command
    }

    const aliases = command.aliases.filter(alias => {
      if (reservedNames.has(alias) || claimedAliases.has(alias)) {
        logForDebugging(
          'Skipping plugin alias ' +
            alias +
            ' for ' +
            command.name +
            ' because another command already owns that name',
          { level: 'warn' },
        )
        return false
      }

      claimedAliases.add(alias)
      return true
    })

    if (aliases.length === command.aliases.length) {
      return command
    }

    if (aliases.length === 0) {
      return {
        ...command,
        aliases: undefined,
      }
    }

    return {
      ...command,
      aliases,
    }
  })
}
