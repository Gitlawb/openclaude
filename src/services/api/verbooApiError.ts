import axios from 'axios'
import { z } from 'zod'

const apiErrorBodySchema = z
  .object({
    error: z.string().min(1),
    code: z.string().min(1).optional(),
  })
  .passthrough()

export type VerbooApiErrorKind = 'http' | 'network' | 'contract' | 'request'

export class VerbooApiError extends Error {
  readonly kind: VerbooApiErrorKind
  readonly status?: number
  readonly code?: string
  readonly retryAfterSeconds?: number

  constructor({
    message,
    kind,
    status,
    code,
    retryAfterSeconds,
    cause,
  }: {
    message: string
    kind: VerbooApiErrorKind
    status?: number
    code?: string
    retryAfterSeconds?: number
    cause?: unknown
  }) {
    super(message, { cause })
    this.name = 'VerbooApiError'
    this.kind = kind
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function parseRetryAfter(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds)
    : undefined
}

export function toVerbooApiError(
  error: unknown,
  fallbackMessage: string,
): VerbooApiError {
  if (error instanceof VerbooApiError) return error

  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status !== undefined) {
      const parsed = apiErrorBodySchema.safeParse(error.response?.data)
      return new VerbooApiError({
        message: parsed.success ? parsed.data.error : fallbackMessage,
        kind: 'http',
        status,
        code: parsed.success ? parsed.data.code : undefined,
        retryAfterSeconds: parseRetryAfter(
          error.response?.headers?.['retry-after'],
        ),
      })
    }
    return new VerbooApiError({
      message: fallbackMessage,
      kind: error.code === 'ERR_CANCELED' ? 'request' : 'network',
      code: error.code === 'ERR_CANCELED' ? 'request_cancelled' : ['ECONNABORTED','ETIMEDOUT'].includes(error.code ?? '') ? 'request_timeout' : 'network_error',
    })
  }

  return new VerbooApiError({
    message: fallbackMessage,
    kind: 'request',
    code: 'unknown',
  })
}

export function parseApiEnvelope<S extends z.ZodTypeAny>(
  schema: S,
  payload: unknown,
  contractName: string,
): z.output<S> {
  const envelope = z
    .object({ data: z.unknown() })
    .passthrough()
    .safeParse(payload)
  const result = envelope.success ? schema.safeParse(envelope.data.data) : null
  if (!result?.success) {
    throw new VerbooApiError({
      message: `Resposta inválida de ${contractName}.`,
      kind: 'contract',
      code: 'contract_error',
      cause: result?.error ?? (envelope.success ? undefined : envelope.error),
    })
  }
  return result.data
}

export function parseRequest<S extends z.ZodTypeAny>(
  schema: S,
  payload: unknown,
  contractName: string,
): z.output<S> {
  const result = schema.safeParse(payload)
  if (!result.success) {
    throw new VerbooApiError({
      message: `Dados inválidos para ${contractName}.`,
      kind: 'request',
      code: 'invalid_request',
      cause: result.error,
    })
  }
  return result.data
}
