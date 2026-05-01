import { z } from 'zod'

export type GithubCopilotModel = {
  id: string
  providerID: 'github-copilot'
  api: {
    id: string
    url: string
    npm: string
  }
  status: 'active'
  limit: {
    context: number
    input: number
    output: number
  }
  capabilities: {
    temperature: boolean
    reasoning: boolean
    attachment: boolean
    toolcall: boolean
    input: {
      text: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
    output: {
      text: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
    interleaved: boolean
  }
  family: string
  name: string
  cost: {
    input: number
    output: number
    cache: {
      read: number
      write: number
    }
  }
  options: Record<string, unknown>
  headers: Record<string, string>
  release_date: string
  variants: Record<string, unknown>
}

export const schema = z.object({
  data: z.array(
    z.object({
      model_picker_enabled: z.boolean(),
      id: z.string(),
      name: z.string(),
      version: z.string(),
      supported_endpoints: z.array(z.string()).optional(),
      policy: z
        .object({
          state: z.string().optional(),
        })
        .optional(),
      capabilities: z.object({
        family: z.string(),
        limits: z.object({
          max_context_window_tokens: z.number().optional(),
          max_output_tokens: z.number().optional(),
          max_prompt_tokens: z.number().optional(),
          vision: z
            .object({
              max_prompt_image_size: z.number(),
              max_prompt_images: z.number(),
              supported_media_types: z.array(z.string()),
            })
            .optional(),
        }).optional(),
        supports: z.object({
          adaptive_thinking: z.boolean().optional(),
          max_thinking_budget: z.number().optional(),
          min_thinking_budget: z.number().optional(),
          reasoning_effort: z.array(z.string()).optional(),
          streaming: z.boolean().optional(),
          structured_outputs: z.boolean().optional(),
          tool_calls: z.boolean().optional(),
          vision: z.boolean().optional(),
        }).optional(),
      }).optional(),
    }),
  ),
})

type RemoteItem = z.infer<typeof schema>['data'][number]

function build(
  key: string,
  remote: RemoteItem,
  url: string,
  prev?: GithubCopilotModel,
): GithubCopilotModel {
  const reasoning =
    Boolean(remote.capabilities?.supports?.adaptive_thinking) ||
    Boolean(remote.capabilities?.supports?.reasoning_effort?.length) ||
    remote.capabilities?.supports?.max_thinking_budget !== undefined ||
    remote.capabilities?.supports?.min_thinking_budget !== undefined
  const image =
    (remote.capabilities?.supports?.vision ?? false) ||
    (remote.capabilities?.limits?.vision?.supported_media_types ?? []).some(item =>
      item.startsWith('image/'),
    )
  const isMessagesApi = remote.supported_endpoints?.includes('/v1/messages') ?? false

  return {
    id: key,
    providerID: 'github-copilot',
    api: {
      id: remote.id,
      url: isMessagesApi ? `${url}/v1` : url,
      npm: isMessagesApi ? '@ai-sdk/anthropic' : '@ai-sdk/github-copilot',
    },
    status: 'active',
    limit: {
      context: remote.capabilities?.limits?.max_context_window_tokens ?? 8192,
      input: remote.capabilities?.limits?.max_prompt_tokens ?? 8192,
      output: remote.capabilities?.limits?.max_output_tokens ?? 4096,
    },
    capabilities: {
      temperature: prev?.capabilities.temperature ?? true,
      reasoning: prev?.capabilities.reasoning ?? reasoning,
      attachment: prev?.capabilities.attachment ?? true,
      toolcall: remote.capabilities?.supports?.tool_calls ?? false,
      input: {
        text: true,
        audio: false,
        image,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    family: prev?.family ?? remote.capabilities?.family ?? 'unknown',
    name: prev?.name ?? remote.name,
    cost: {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    },
    options: prev?.options ?? {},
    headers: prev?.headers ?? {},
    release_date:
      prev?.release_date ??
      (remote.version.startsWith(`${remote.id}-`)
        ? remote.version.slice(remote.id.length + 1)
        : remote.version),
    variants: prev?.variants ?? {},
  }
}

export async function get(
  baseURL: string,
  headers: HeadersInit = {},
  existing: Record<string, GithubCopilotModel> = {},
): Promise<Record<string, GithubCopilotModel>> {
  const response = await fetch(`${baseURL}/models`, {
    headers,
    signal: AbortSignal.timeout(5_000),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch models from ${baseURL}/models: ${response.status} ${response.statusText}`)
  }

  const rawResponse = await response.json()
  
  try {
    const data = schema.parse(rawResponse)
    const result = { ...existing }
    const allModels = data.data

    const remote = new Map(
      allModels
        .filter(model => model.model_picker_enabled && model.policy?.state !== 'disabled')
        .map(model => [model.id, model] as const),
    )


    for (const [key, model] of Object.entries(result)) {
      const remoteModel = remote.get(model.api.id)
      if (!remoteModel) {
        delete result[key]
        continue
      }
      result[key] = build(key, remoteModel, baseURL, model)
    }

    for (const [id, remoteModel] of remote) {
      if (id in result) continue
      result[id] = build(id, remoteModel, baseURL)
    }

    return result
  } catch (err) {
    throw err
  }
}
