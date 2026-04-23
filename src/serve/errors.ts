export const ErrorCode = {
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMIT: "RATE_LIMIT",
  CONFLICT: "CONFLICT",
  VALIDATION: "VALIDATION",
  VAULT_UNAVAILABLE: "VAULT_UNAVAILABLE",
  TRIPWIRE_BLOCKED: "TRIPWIRE_BLOCKED",
  MODEL_RATE_LIMIT: "MODEL_RATE_LIMIT",
  MODEL_TIMEOUT: "MODEL_TIMEOUT",
  MODEL_AUTH: "MODEL_AUTH",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
  NETWORK: "NETWORK",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

const STATUS_MAP: Record<ErrorCodeType, number> = {
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  RATE_LIMIT: 429,
  CONFLICT: 409,
  VALIDATION: 400,
  VAULT_UNAVAILABLE: 503,
  TRIPWIRE_BLOCKED: 403,
  MODEL_RATE_LIMIT: 429,
  MODEL_TIMEOUT: 504,
  MODEL_AUTH: 401,
  MODEL_NOT_FOUND: 404,
  NETWORK: 502,
  INTERNAL: 500,
};

export class ServerError extends Error {
  code: ErrorCodeType;
  httpStatus: number;
  extras?: Record<string, unknown>;
  constructor(code: ErrorCodeType, message: string, extras?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.httpStatus = STATUS_MAP[code];
    this.extras = extras;
  }
}

export function errorResponse(err: ServerError): { status: number; body: { error: Record<string, unknown> } } {
  return {
    status: err.httpStatus,
    body: { error: { code: err.code, message: err.message, ...(err.extras ?? {}) } },
  };
}
