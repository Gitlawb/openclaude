/**
 * Utilitário de sanitização para prevenir exposição de dados sensíveis em logs
 *
 * @module security/sanitize
 */

// Padrões de dados sensíveis que devem ser redactados
const SENSITIVE_PATTERNS = [
  // API Keys (mais permissivo para capturar valores curtos também)
  /api[_-]?key[=:\s]+['"]?([a-zA-Z0-9_-]{6,})['"]?/gi,
  /anthropic[_-]?api[_-]?key[=:\s]+['"]?([a-zA-Z0-9_-]{6,})['"]?/gi,
  /openai[_-]?api[_-]?key[=:\s]+['"]?([a-zA-Z0-9_-]{6,})['"]?/gi,

  // Tokens (mais permissivo)
  /token[=:\s]+['"]?([a-zA-Z0-9_.-]{6,})['"]?/gi,
  /bearer\s+([a-zA-Z0-9_.-]{6,})/gi,
  /authorization[=:\s]+['"]?bearer\s+([a-zA-Z0-9_.-]{6,})['"]?/gi,

  // Passwords
  /password[=:\s]+['"]?([^'"\s]{6,})['"]?/gi,
  /passwd[=:\s]+['"]?([^'"\s]{6,})['"]?/gi,

  // AWS Credentials
  /aws[_-]?access[_-]?key[_-]?id[=:\s]+['"]?([A-Z0-9]{20})['"]?/gi,
  /aws[_-]?secret[_-]?access[_-]?key[=:\s]+['"]?([A-Za-z0-9/+=]{40})['"]?/gi,

  // GitHub Tokens
  /gh[ps]_[a-zA-Z0-9]{36,}/gi,

  // Generic secrets (mais permissivo)
  /secret[=:\s]+['"]?([a-zA-Z0-9_.-]{6,})['"]?/gi,

  // JWT tokens
  /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/gi,

  // Private keys
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
]

// Nomes de variáveis de ambiente sensíveis
const SENSITIVE_ENV_KEYS = [
  'API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'PRIVATE_KEY',
  'CLIENT_SECRET',
  'OAUTH_SECRET',
]

/**
 * Sanitiza uma string removendo dados sensíveis
 *
 * @param input - String a ser sanitizada
 * @returns String com dados sensíveis redactados
 */
export function sanitizeString(input: string): string {
  if (!input || typeof input !== 'string') {
    return input
  }

  let sanitized = input

  // Aplicar todos os padrões de redação
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match, secret) => {
      if (!secret) return match
      // Manter primeiros 4 caracteres para debug, redactar o resto
      const visible = secret.length > 8 ? secret.substring(0, 4) : ''
      return match.replace(secret, `${visible}[REDACTED]`)
    })
  }

  return sanitized
}

/**
 * Sanitiza um objeto recursivamente, redactando valores sensíveis
 *
 * @param obj - Objeto a ser sanitizado
 * @param maxDepth - Profundidade máxima de recursão (previne loops infinitos)
 * @returns Objeto sanitizado
 */
export function sanitizeObject<T = any>(obj: T, maxDepth = 10): T {
  if (maxDepth <= 0) {
    return '[MAX_DEPTH_EXCEEDED]' as any
  }

  if (obj === null || obj === undefined) {
    return obj
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj) as any
  }

  if (typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, maxDepth - 1)) as any
  }

  const sanitized: any = {}

  for (const [key, value] of Object.entries(obj)) {
    const keyUpper = key.toUpperCase()

    // Verificar se a chave indica dado sensível
    const isSensitiveKey = SENSITIVE_ENV_KEYS.some(sensitiveKey =>
      keyUpper.includes(sensitiveKey)
    )

    if (isSensitiveKey) {
      // Redactar completamente valores de chaves sensíveis
      sanitized[key] = '[REDACTED]'
    } else if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value)
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value, maxDepth - 1)
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Sanitiza variáveis de ambiente para logging seguro
 *
 * @param env - Objeto de variáveis de ambiente (default: process.env)
 * @returns Objeto sanitizado
 */
export function sanitizeEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const sanitized: Record<string, string> = {}

  for (const [key, value] of Object.entries(env)) {
    if (!value) continue

    const keyUpper = key.toUpperCase()
    const isSensitive = SENSITIVE_ENV_KEYS.some(sensitiveKey =>
      keyUpper.includes(sensitiveKey)
    )

    if (isSensitive) {
      // Mostrar apenas primeiros 4 caracteres
      const visible = value.length > 8 ? value.substring(0, 4) : ''
      sanitized[key] = `${visible}[REDACTED]`
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Cria uma versão segura de console.log que sanitiza automaticamente
 */
export function createSafeLogger() {
  return {
    log: (...args: any[]) => {
      const sanitized = args.map(arg =>
        typeof arg === 'object' ? sanitizeObject(arg) : sanitizeString(String(arg))
      )
      console.log(...sanitized)
    },

    error: (...args: any[]) => {
      const sanitized = args.map(arg =>
        typeof arg === 'object' ? sanitizeObject(arg) : sanitizeString(String(arg))
      )
      console.error(...sanitized)
    },

    warn: (...args: any[]) => {
      const sanitized = args.map(arg =>
        typeof arg === 'object' ? sanitizeObject(arg) : sanitizeString(String(arg))
      )
      console.warn(...sanitized)
    },

    debug: (...args: any[]) => {
      const sanitized = args.map(arg =>
        typeof arg === 'object' ? sanitizeObject(arg) : sanitizeString(String(arg))
      )
      console.debug(...sanitized)
    },
  }
}

/**
 * Logger seguro global
 */
export const safeLogger = createSafeLogger()

/**
 * Verifica se uma string contém dados sensíveis
 *
 * @param input - String a verificar
 * @returns true se contém dados sensíveis
 */
export function containsSensitiveData(input: string): boolean {
  if (!input || typeof input !== 'string') {
    return false
  }

  return SENSITIVE_PATTERNS.some(pattern => {
    pattern.lastIndex = 0 // Reset regex state
    return pattern.test(input)
  })
}

/**
 * Registra acesso a variável de ambiente sensível para auditoria
 *
 * @param key - Nome da variável acessada
 */
export function logSensitiveEnvAccess(key: string): void {
  if (process.env.CLAUDE_CODE_AUDIT_ENV_ACCESS === '1') {
    const timestamp = new Date().toISOString()
    const stack = new Error().stack?.split('\n').slice(2, 4).join('\n') || 'unknown'

    // Log para stderr para não poluir stdout
    console.error(`[AUDIT] ${timestamp} - Sensitive env access: ${key}\n${stack}`)
  }
}
