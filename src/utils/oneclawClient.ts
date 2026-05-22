import { createClient, type OneclawClient } from '@1claw/sdk'
import {
  getOneclawBaseUrl,
  getOneclawAgentApiKey,
  getOneclawAgentId,
  loadOneclawConfig,
} from './oneclaw.js'

let cachedAgentClient: OneclawClient | null = null
let agentAuthenticated = false

export function getOneclawAgentClient(): OneclawClient | null {
  if (cachedAgentClient) return cachedAgentClient

  const apiKey = getOneclawAgentApiKey()
  if (!apiKey) return null

  const agentId = getOneclawAgentId()
  const baseUrl = getOneclawBaseUrl()

  cachedAgentClient = createClient({
    baseUrl,
    apiKey,
    ...(agentId ? { agentId } : {}),
  })

  return cachedAgentClient
}

export async function getAuthenticatedAgentClient(): Promise<OneclawClient | null> {
  const client = getOneclawAgentClient()
  if (!client) return null

  if (agentAuthenticated) return client

  const agentId = getOneclawAgentId()
  const apiKey = getOneclawAgentApiKey()
  if (!agentId || !apiKey) return client

  try {
    await client.auth.agentToken({ agent_id: agentId, api_key: apiKey })
    agentAuthenticated = true
  } catch {
    // Auth may fail if the agent uses a different auth method;
    // the client still works for endpoints that accept the raw API key
  }

  return client
}

export function createOneclawHumanClient(apiKey: string): OneclawClient {
  return createClient({
    baseUrl: getOneclawBaseUrl(),
    apiKey,
  })
}

export function resetOneclawClientCache(): void {
  cachedAgentClient = null
  agentAuthenticated = false
}

export async function resolveSecretFromVault(
  secretPath: string,
): Promise<string | null> {
  const client = await getAuthenticatedAgentClient()
  if (!client) return null

  const config = loadOneclawConfig()
  if (!config?.vaultId) return null

  try {
    const res = await client.secrets.get(config.vaultId, secretPath)
    if (res.error) return null
    return res.data?.value ?? null
  } catch {
    return null
  }
}
