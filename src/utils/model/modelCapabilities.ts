// External build: internal model-capabilities fetch/cache path is disabled.
// Preserve a stable public surface so callers can continue to import it.

export type ModelCapability = {
  id: string
  max_input_tokens?: number
  max_tokens?: number
}

export function getModelCapability(
  _model: string,
): ModelCapability | undefined {
  return undefined
}

export async function refreshModelCapabilities(): Promise<void> {}
