import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { isOneclawConfigured, loadOneclawConfig } from '../../utils/oneclaw.js'
import { getAuthenticatedAgentClient } from '../../utils/oneclawClient.js'
import {
  SUBMIT_TX_TOOL_NAME,
  SIGN_TX_TOOL_NAME,
  SIMULATE_TX_TOOL_NAME,
} from './constants.js'
import {
  SUBMIT_TX_DESCRIPTION,
  SUBMIT_TX_PROMPT,
  SIGN_TX_DESCRIPTION,
  SIGN_TX_PROMPT,
  SIMULATE_TX_DESCRIPTION,
  SIMULATE_TX_PROMPT,
} from './prompt.js'

const txInputSchema = lazySchema(() =>
  z.strictObject({
    chain: z
      .string()
      .describe(
        'Target blockchain (e.g. "ethereum", "base", "sepolia", "arbitrum")',
      ),
    to: z.string().describe('Recipient address (0x...)'),
    value: z
      .string()
      .optional()
      .describe('Amount in ETH (e.g. "0.01"). Omit for contract calls with no value.'),
    data: z
      .string()
      .optional()
      .describe('Contract calldata hex (0x...). Required for contract interactions.'),
    gas_limit: z
      .number()
      .optional()
      .describe('Gas limit override'),
  }),
)
type TxInputSchema = ReturnType<typeof txInputSchema>

type TxOutput = {
  status: string
  tx_hash?: string
  signed_tx?: string
  from?: string
  error?: string
}

type SimOutput = {
  status: string
  gas_used?: number
  error?: string
  revert_reason?: string
  tenderly_url?: string
}

const txOutputSchema = lazySchema(() =>
  z.object({
    status: z.string(),
    tx_hash: z.string().optional(),
    signed_tx: z.string().optional(),
    from: z.string().optional(),
    error: z.string().optional(),
  }),
)
type TxOutputSchema = ReturnType<typeof txOutputSchema>

const simulateOutputSchema = lazySchema(() =>
  z.object({
    status: z.string(),
    gas_used: z.number().optional(),
    error: z.string().optional(),
    revert_reason: z.string().optional(),
    tenderly_url: z.string().optional(),
  }),
)
type SimulateOutputSchema = ReturnType<typeof simulateOutputSchema>

function isIntentsEnabled(): boolean {
  if (!isOneclawConfigured()) return false
  const config = loadOneclawConfig()
  return config?.intentsEnabled === true
}

function txResultToBlock(content: TxOutput, toolUseID: string): ToolResultBlockParam {
  const lines: string[] = [`Status: ${content.status}`]
  if (content.tx_hash) lines.push(`TX Hash: ${content.tx_hash}`)
  if (content.from) lines.push(`From: ${content.from}`)
  if (content.signed_tx) lines.push(`Signed TX: ${content.signed_tx.slice(0, 66)}...`)
  if (content.error) lines.push(`Error: ${content.error}`)
  return { type: 'tool_result', tool_use_id: toolUseID, content: lines.join('\n') }
}

function simResultToBlock(content: SimOutput, toolUseID: string): ToolResultBlockParam {
  const lines: string[] = [`Status: ${content.status}`]
  if (content.gas_used) lines.push(`Gas used: ${content.gas_used}`)
  if (content.revert_reason) lines.push(`Revert: ${content.revert_reason}`)
  if (content.tenderly_url) lines.push(`Tenderly: ${content.tenderly_url}`)
  if (content.error) lines.push(`Error: ${content.error}`)
  return { type: 'tool_result', tool_use_id: toolUseID, content: lines.join('\n') }
}

export const OneclawSubmitTransactionTool = buildTool({
  name: SUBMIT_TX_TOOL_NAME,
  searchHint: 'submit on-chain EVM transaction via 1claw',
  maxResultSizeChars: 10_000,

  async description() {
    return SUBMIT_TX_DESCRIPTION
  },
  async prompt() {
    return SUBMIT_TX_PROMPT
  },
  get inputSchema(): TxInputSchema {
    return txInputSchema()
  },
  get outputSchema(): TxOutputSchema {
    return txOutputSchema()
  },
  isEnabled: isIntentsEnabled,
  isReadOnly: () => false,
  isConcurrencySafe: () => false,

  async checkPermissions(input) {
    return {
      behavior: 'ask' as const,
      updatedInput: input,
      message: `Submit transaction: ${input.value ?? '0'} ETH to ${input.to} on ${input.chain}`,
    }
  },

  renderToolUseMessage() {
    return null
  },

  mapToolResultToToolResultBlockParam: txResultToBlock,

  async call(input) {
    const client = await getAuthenticatedAgentClient()
    if (!client) {
      return { data: { status: 'error', error: '1claw not configured. Run /1claw to set up.' } }
    }

    const config = loadOneclawConfig()
    if (!config) {
      return { data: { status: 'error', error: '1claw config not found' } }
    }

    try {
      const res = await client.agents.submitTransaction(config.agentId, {
        chain: input.chain,
        to: input.to,
        value: input.value ?? '0',
        data: input.data ?? '0x',
        simulate_first: false,
        ...(input.gas_limit ? { gas_limit: input.gas_limit } : {}),
      })

      if (res.error) {
        return { data: { status: 'error', error: res.error.message } }
      }

      return {
        data: {
          status: res.data?.status ?? 'submitted',
          tx_hash: res.data?.tx_hash,
          from: res.data?.to,
        },
      }
    } catch (err: any) {
      return { data: { status: 'error', error: err?.message ?? String(err) } }
    }
  },
} satisfies ToolDef<TxInputSchema, TxOutput>)

export const OneclawSignTransactionTool = buildTool({
  name: SIGN_TX_TOOL_NAME,
  searchHint: 'sign EVM transaction without broadcasting via 1claw',
  maxResultSizeChars: 10_000,

  async description() {
    return SIGN_TX_DESCRIPTION
  },
  async prompt() {
    return SIGN_TX_PROMPT
  },
  get inputSchema(): TxInputSchema {
    return txInputSchema()
  },
  get outputSchema(): TxOutputSchema {
    return txOutputSchema()
  },
  isEnabled: isIntentsEnabled,
  isReadOnly: () => false,
  isConcurrencySafe: () => false,

  async checkPermissions(input) {
    return {
      behavior: 'ask' as const,
      updatedInput: input,
      message: `Sign transaction (no broadcast): ${input.value ?? '0'} ETH to ${input.to} on ${input.chain}`,
    }
  },

  renderToolUseMessage() {
    return null
  },

  mapToolResultToToolResultBlockParam: txResultToBlock,

  async call(input) {
    const client = await getAuthenticatedAgentClient()
    if (!client) {
      return { data: { status: 'error', error: '1claw not configured. Run /1claw to set up.' } }
    }

    const config = loadOneclawConfig()
    if (!config) {
      return { data: { status: 'error', error: '1claw config not found' } }
    }

    try {
      const res = await client.agents.signTransaction(config.agentId, {
        chain: input.chain,
        to: input.to,
        value: input.value ?? '0',
        data: input.data ?? '0x',
        ...(input.gas_limit ? { gas_limit: input.gas_limit } : {}),
      })

      if (res.error) {
        return { data: { status: 'error', error: res.error.message } }
      }

      return {
        data: {
          status: 'signed',
          tx_hash: res.data?.tx_hash,
          signed_tx: res.data?.signed_tx ?? undefined,
          from: res.data?.from,
        },
      }
    } catch (err: any) {
      return { data: { status: 'error', error: err?.message ?? String(err) } }
    }
  },
} satisfies ToolDef<TxInputSchema, TxOutput>)

export const OneclawSimulateTransactionTool = buildTool({
  name: SIMULATE_TX_TOOL_NAME,
  searchHint: 'simulate EVM transaction via Tenderly before signing',
  maxResultSizeChars: 10_000,

  async description() {
    return SIMULATE_TX_DESCRIPTION
  },
  async prompt() {
    return SIMULATE_TX_PROMPT
  },
  get inputSchema(): TxInputSchema {
    return txInputSchema()
  },
  get outputSchema(): SimulateOutputSchema {
    return simulateOutputSchema()
  },
  isEnabled: isIntentsEnabled,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async checkPermissions(input) {
    return { behavior: 'allow' as const, updatedInput: input }
  },

  renderToolUseMessage() {
    return null
  },

  mapToolResultToToolResultBlockParam: simResultToBlock,

  async call(input) {
    const client = await getAuthenticatedAgentClient()
    if (!client) {
      return { data: { status: 'error', error: '1claw not configured. Run /1claw to set up.' } }
    }

    const config = loadOneclawConfig()
    if (!config) {
      return { data: { status: 'error', error: '1claw config not found' } }
    }

    try {
      const res = await client.agents.simulateTransaction(config.agentId, {
        chain: input.chain,
        to: input.to,
        value: input.value ?? '0',
        data: input.data ?? '0x',
        ...(input.gas_limit ? { gas_limit: input.gas_limit } : {}),
      })

      if (res.error) {
        return { data: { status: 'error', error: res.error.message } }
      }

      return {
        data: {
          status: res.data?.status ?? 'unknown',
          gas_used: res.data?.gas_used,
          error: res.data?.error,
          revert_reason: res.data?.revert_reason,
          tenderly_url: res.data?.tenderly_dashboard_url,
        },
      }
    } catch (err: any) {
      return { data: { status: 'error', error: err?.message ?? String(err) } }
    }
  },
} satisfies ToolDef<TxInputSchema, SimOutput>)
