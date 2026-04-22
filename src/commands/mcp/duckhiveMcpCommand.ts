/**
 * DuckHive MCP CLI subcommand
 *
 * Registers `duckhive mcp` subcommand group:
 *   duckhive mcp list    — List configured MCP servers
 *   duckhive mcp add     — Add an MCP server (stdio by default)
 *   duckhive mcp remove  — Remove an MCP server
 *   duckhive mcp reload  — Reload MCP servers
 *
 * Config file: ~/.config/duckhive/mcp-servers.json
 */
import { type Command } from '@commander-js/extra-typings'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { resolve } from 'path'

const DUCKHIVE_MCP_CONFIG = resolve(process.env.HOME ?? '~', '.config/duckhive/mcp-servers.json')

interface McpServer {
  type?: string
  command?: string
  url?: string
}

function loadServers(): Record<string, McpServer> {
  try {
    if (existsSync(DUCKHIVE_MCP_CONFIG)) {
      return JSON.parse(readFileSync(DUCKHIVE_MCP_CONFIG, 'utf8'))
    }
  } catch {}
  return {}
}

function saveServers(servers: Record<string, McpServer>): void {
  mkdirSync(resolve(DUCKHIVE_MCP_CONFIG, '..'), { recursive: true })
  writeFileSync(DUCKHIVE_MCP_CONFIG, JSON.stringify(servers, null, 2), 'utf8')
}

function cliError(msg: string): void {
  console.error(msg)
  process.exit(1)
}

function cliOk(msg: string): void {
  console.log(msg)
}

export function registerDuckhiveMcpCommand(program: Command): void {
  // Register 'mcp' as the top-level command (replaces OpenClaude's mcp when
  // running as duckhive binary).
  // Usage: duckhive mcp list|add|remove|reload
  const mcp = program
    .command('mcp')
    .description('Manage DuckHive MCP servers')
    .configureHelp(createSortedHelpConfig())
    .enablePositionalOptions()

  // duckhive mcp list
  mcp
    .command('list')
    .description('List configured MCP servers')
    .action(async () => {
      const servers = loadServers()
      const entries = Object.entries(servers)

      if (entries.length === 0) {
        cliOk(`No MCP servers configured.\nAdd one with: duckhive mcp add <name> <command>`)
        return
      }

      cliOk(`DuckHive MCP Servers (${entries.length})\n${'─'.repeat(50)}`)
      for (const [name, server] of entries) {
        const transport = server.type ?? 'stdio'
        const url = server.url ?? server.command ?? ''
        cliOk(`  ${name.padEnd(20)} [${transport}] ${url}`)
      }
    })

  // duckhive mcp add <name> <commandOrUrl> [args...]
  // Use allowUnknownOption() so flags like -y in "npx -y @modelcontextprotocol/server-filesystem"
  // don't get parsed as subcommand options.
  mcp
    .command('add <name> <commandOrUrl> [args...]')
    .description(
      'Add an MCP server (default: stdio)\n\n' +
        'Examples:\n' +
        '  duckhive mcp add rsc npx -y @modelcontextprotocol/server-filesystem ~/projects\n' +
        '  duckhive mcp add github npx -y @modelcontextprotocol/server-github\n' +
        '  duckhive mcp add brave-search npx -y @modelcontextprotocol/server-brave-search',
    )
    .allowUnknownOption()
    .option(
      '-t, --transport <transport>',
      'Transport type (stdio, http, sse). Defaults to stdio.',
      'stdio',
    )
    .option(
      '-u, --url <url>',
      'Server URL (for http/sse transports)',
    )
    .action(async (name: string, commandOrUrl: string, args: string[], options: { transport?: string; url?: string }) => {
      if (!name) {
        cliError('Error: Server name is required.\nUsage: duckhive dmcp add <name> <command> [args...]')
      }
      if (!commandOrUrl && options.transport === 'stdio') {
        cliError('Error: Command is required for stdio transport.\nUsage: duckhive dmcp add <name> <command> [args...]')
      }

      const servers = loadServers()
      const transport = options.transport ?? 'stdio'
      const cmdStr = [commandOrUrl, ...args].join(' ')

      if (transport === 'stdio') {
        servers[name] = { type: 'stdio', command: cmdStr }
      } else {
        if (!options.url) {
          cliError(`Error: --url is required for ${transport} transport.`)
        }
        servers[name] = { type: transport, url: options.url }
      }

      saveServers(servers)
      cliOk(`Added MCP server "${name}" (${transport})`)
    })

  // duckhive mcp remove <name>
  mcp
    .command('remove <name>')
    .description('Remove an MCP server')
    .action(async (name: string) => {
      if (!name) {
        cliError('Error: Server name is required.\nUsage: duckhive dmcp remove <name>')
      }

      const servers = loadServers()
      if (!servers[name]) {
        cliError(`Error: MCP server "${name}" not found.`)
      }

      delete servers[name]
      saveServers(servers)
      cliOk(`Removed MCP server "${name}"`)
    })

  // duckhive mcp reload
  mcp
    .command('reload')
    .description('Reload MCP servers (restart DuckHive to apply changes)')
    .action(async () => {
      const servers = loadServers()
      const entries = Object.entries(servers)

      if (entries.length === 0) {
        cliOk('No MCP servers configured.')
        return
      }

      cliOk(`MCP servers pending reload (${entries.length})\n${'─'.repeat(50)}`)
      for (const [name, server] of entries) {
        const transport = server.type ?? 'stdio'
        const url = server.url ?? server.command ?? ''
        cliOk(`  ${name.padEnd(20)} [${transport}] ${url}`)
      }
      cliOk('\nRestart DuckHive to reload MCP servers.')
    })
}

function createSortedHelpConfig() {
  return {
    sortSubcommands: true,
  }
}
