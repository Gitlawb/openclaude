/**
 * MCP Skills — discover skills from MCP server resources.
 *
 * Skills are MCP resources with URI scheme "skill://" or MIME type
 * containing "skill". They are converted to Commands and appear in the
 * slash command search alongside prompt-based MCP commands.
 *
 * Unlike prompts (which are parameterized templates), skills are static
 * instruction sets that guide the model's behavior for a task.
 */

import type { MCPServerConnection } from '../services/mcp/mcpClient.js'
import type { Command } from '../types/command.js'
import { memoizeWithLRU } from '../utils/memoize.js'
import { logMCPError } from '../utils/log.js'
import { errorMessage } from '../utils/errors.js'
import { normalizeNameForMCP } from '../services/mcp/normalization.js'
import { ListResourcesResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { getMCPSkillBuilders } from './mcpSkillBuilders.js'

async function ensureConnectedClient(client: MCPServerConnection) {
  if (client.type !== 'connected') {
    throw new Error(`MCP server "${client.name}" is not connected`)
  }
  return client
}

/**
 * Fetch skills from an MCP server's resources and convert them to Commands.
 *
 * A resource is treated as a skill if:
 * - Its URI starts with "skill://"
 * - Or its mimeType contains "skill"
 * - Or its name ends with ".skill.md"
 */
export const fetchMcpSkillsForClient = memoizeWithLRU(
  async (client: MCPServerConnection): Promise<Command[]> => {
    if (client.type !== 'connected') return []

    try {
      if (!client.capabilities?.resources) {
        return []
      }

      const result = await client.client.request(
        { method: 'resources/list' },
        ListResourcesResultSchema,
      )

      if (!result.resources) return []

      // Filter for skill-like resources
      const skills = result.resources.filter(
        (r) =>
          r.uri.startsWith('skill://') ||
          r.mimeType?.includes('skill') ||
          r.name?.endsWith('.skill.md'),
      )

      if (skills.length === 0) return []

      const { createSkillCommand } = getMCPSkillBuilders()

      return skills.map((resource) => {
        const skillName = resource.name ?? resource.uri.split('/').pop() ?? 'unknown'
        return createSkillCommand({
          name: `mcp__${normalizeNameForMCP(client.name)}__${normalizeNameForMCP(skillName)}`,
          description: resource.description ?? `Skill from ${client.name}`,
          source: 'mcp' as const,
          async getContent() {
            const connected = await ensureConnectedClient(client)
            const res = await connected.client.request(
              {
                method: 'resources/read',
                params: { uri: resource.uri },
              },
              {} as any, // ReadResourceResultSchema
            )
            const contents = (res as { contents?: Array<{ text?: string }> }).contents
            return contents?.[0]?.text ?? ''
          },
        })
      })
    } catch (error) {
      logMCPError(
        client.name,
        `Failed to fetch MCP skills: ${errorMessage(error)}`,
      )
      return []
    }
  },
  (client: MCPServerConnection) => client.name,
)
