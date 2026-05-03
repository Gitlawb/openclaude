/**
 * Utilitário para validação segura de Buffer operations
 * Previne DoS via alocação excessiva de memória
 *
 * @module security/bufferValidation
 */

/**
 * Limites de tamanho padrão
 */
export const DEFAULT_MAX_BUFFER_SIZE = 10_000_000 // 10MB
export const DEFAULT_MAX_STRING_SIZE = 50_000_000 // 50MB
export const DEFAULT_MAX_BASE64_SIZE = 13_333_333 // ~10MB após decode

/**
 * Erro lançado quando tamanho excede limite
 */
export class BufferSizeError extends Error {
  constructor(
    message: string,
    public readonly attemptedSize: number,
    public readonly maxSize: number
  ) {
    super(message)
    this.name = 'BufferSizeError'
  }
}

/**
 * Estima tamanho de buffer resultante de base64
 */
export function estimateBase64DecodedSize(base64: string): number {
  // Base64 usa 4 caracteres para representar 3 bytes
  // Padding (=) no final não conta
  const withoutPadding = base64.replace(/=/g, '')
  return Math.floor((withoutPadding.length * 3) / 4)
}

/**
 * Decodifica base64 com validação de tamanho
 */
export function safeBase64Decode(
  input: string,
  maxSize: number = DEFAULT_MAX_BASE64_SIZE
): Buffer {
  if (!input || typeof input !== 'string') {
    throw new Error('Input must be a non-empty string')
  }

  const estimatedSize = estimateBase64DecodedSize(input)

  if (estimatedSize > maxSize) {
    throw new BufferSizeError(
      `Base64 input too large: estimated ${estimatedSize} bytes (max: ${maxSize})`,
      estimatedSize,
      maxSize
    )
  }

  try {
    return Buffer.from(input, 'base64')
  } catch (error: any) {
    throw new Error(`Failed to decode base64: ${error.message}`)
  }
}

/**
 * Codifica buffer para base64 com validação de tamanho
 */
export function safeBase64Encode(
  buffer: Buffer,
  maxSize: number = DEFAULT_MAX_BUFFER_SIZE
): string {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Input must be a Buffer')
  }

  if (buffer.length > maxSize) {
    throw new BufferSizeError(
      `Buffer too large: ${buffer.length} bytes (max: ${maxSize})`,
      buffer.length,
      maxSize
    )
  }

  return buffer.toString('base64')
}

/**
 * Cria buffer de string com validação de tamanho
 */
export function safeBufferFrom(
  data: string | ArrayBuffer | Uint8Array,
  encoding?: BufferEncoding,
  maxSize: number = DEFAULT_MAX_STRING_SIZE
): Buffer {
  if (typeof data === 'string') {
    // Estimar tamanho em bytes (UTF-8 pode usar até 4 bytes por char)
    const estimatedSize = data.length * 4

    if (estimatedSize > maxSize) {
      throw new BufferSizeError(
        `String too large for buffer: estimated ${estimatedSize} bytes (max: ${maxSize})`,
        estimatedSize,
        maxSize
      )
    }

    return Buffer.from(data, encoding)
  }

  if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
    const size = data.byteLength

    if (size > maxSize) {
      throw new BufferSizeError(
        `Data too large for buffer: ${size} bytes (max: ${maxSize})`,
        size,
        maxSize
      )
    }

    return Buffer.from(data)
  }

  throw new Error('Unsupported data type for buffer creation')
}

/**
 * Aloca buffer com validação de tamanho
 */
export function safeBufferAlloc(
  size: number,
  fill?: string | Buffer | number,
  encoding?: BufferEncoding,
  maxSize: number = DEFAULT_MAX_BUFFER_SIZE
): Buffer {
  if (typeof size !== 'number' || size < 0) {
    throw new Error('Size must be a non-negative number')
  }

  if (size > maxSize) {
    throw new BufferSizeError(
      `Requested buffer size too large: ${size} bytes (max: ${maxSize})`,
      size,
      maxSize
    )
  }

  return Buffer.alloc(size, fill, encoding)
}

/**
 * Concatena buffers com validação de tamanho total
 */
export function safeBufferConcat(
  buffers: Buffer[],
  maxSize: number = DEFAULT_MAX_BUFFER_SIZE
): Buffer {
  if (!Array.isArray(buffers)) {
    throw new Error('Input must be an array of buffers')
  }

  let totalSize = 0
  for (const buffer of buffers) {
    if (!Buffer.isBuffer(buffer)) {
      throw new Error('All items must be buffers')
    }
    totalSize += buffer.length
  }

  if (totalSize > maxSize) {
    throw new BufferSizeError(
      `Total buffer size too large: ${totalSize} bytes (max: ${maxSize})`,
      totalSize,
      maxSize
    )
  }

  return Buffer.concat(buffers)
}

/**
 * Decodifica atob (base64) com validação
 */
export function safeAtob(
  input: string,
  maxSize: number = DEFAULT_MAX_BASE64_SIZE
): string {
  if (!input || typeof input !== 'string') {
    throw new Error('Input must be a non-empty string')
  }

  const estimatedSize = estimateBase64DecodedSize(input)

  if (estimatedSize > maxSize) {
    throw new BufferSizeError(
      `Base64 input too large: estimated ${estimatedSize} bytes (max: ${maxSize})`,
      estimatedSize,
      maxSize
    )
  }

  try {
    // Node.js não tem atob global, usar Buffer
    return Buffer.from(input, 'base64').toString('binary')
  } catch (error: any) {
    throw new Error(`Failed to decode base64: ${error.message}`)
  }
}

/**
 * Codifica btoa (base64) com validação
 */
export function safeBtoa(
  input: string,
  maxSize: number = DEFAULT_MAX_STRING_SIZE
): string {
  if (!input || typeof input !== 'string') {
    throw new Error('Input must be a non-empty string')
  }

  if (input.length > maxSize) {
    throw new BufferSizeError(
      `String too large: ${input.length} bytes (max: ${maxSize})`,
      input.length,
      maxSize
    )
  }

  try {
    // Node.js não tem btoa global, usar Buffer
    return Buffer.from(input, 'binary').toString('base64')
  } catch (error: any) {
    throw new Error(`Failed to encode base64: ${error.message}`)
  }
}

/**
 * Lê arquivo com validação de tamanho
 */
export async function safeReadFile(
  filePath: string,
  maxSize: number = DEFAULT_MAX_BUFFER_SIZE
): Promise<Buffer> {
  const fs = await import('fs/promises')
  const stat = await fs.stat(filePath)

  if (stat.size > maxSize) {
    throw new BufferSizeError(
      `File too large: ${stat.size} bytes (max: ${maxSize})`,
      stat.size,
      maxSize
    )
  }

  return fs.readFile(filePath)
}

/**
 * Lê arquivo como string com validação de tamanho
 */
export async function safeReadFileString(
  filePath: string,
  encoding: BufferEncoding = 'utf8',
  maxSize: number = DEFAULT_MAX_BUFFER_SIZE
): Promise<string> {
  const buffer = await safeReadFile(filePath, maxSize)
  return buffer.toString(encoding)
}

/**
 * Cria stream de leitura com limite de tamanho
 */
export function createSafeLimitedReadStream(
  filePath: string,
  maxSize: number = DEFAULT_MAX_BUFFER_SIZE
) {
  const fs = require('fs')
  const { Transform } = require('stream')

  let bytesRead = 0

  const limiter = new Transform({
    transform(chunk: Buffer, encoding: string, callback: Function) {
      bytesRead += chunk.length

      if (bytesRead > maxSize) {
        callback(
          new BufferSizeError(
            `Stream exceeded size limit: ${bytesRead} bytes (max: ${maxSize})`,
            bytesRead,
            maxSize
          )
        )
        return
      }

      callback(null, chunk)
    },
  })

  return fs.createReadStream(filePath).pipe(limiter)
}

/**
 * Valida tamanho de JSON antes de parse
 */
export function safeJsonParse<T = any>(
  input: string,
  maxSize: number = DEFAULT_MAX_STRING_SIZE
): T {
  if (!input || typeof input !== 'string') {
    throw new Error('Input must be a non-empty string')
  }

  if (input.length > maxSize) {
    throw new BufferSizeError(
      `JSON string too large: ${input.length} bytes (max: ${maxSize})`,
      input.length,
      maxSize
    )
  }

  try {
    return JSON.parse(input)
  } catch (error: any) {
    throw new Error(`Failed to parse JSON: ${error.message}`)
  }
}

/**
 * Valida tamanho de JSON antes de stringify
 */
export function safeJsonStringify(
  value: any,
  maxSize: number = DEFAULT_MAX_STRING_SIZE
): string {
  const result = JSON.stringify(value)

  if (result.length > maxSize) {
    throw new BufferSizeError(
      `JSON output too large: ${result.length} bytes (max: ${maxSize})`,
      result.length,
      maxSize
    )
  }

  return result
}

/**
 * Configuração global de limites
 */
export class BufferLimits {
  private static maxBufferSize = DEFAULT_MAX_BUFFER_SIZE
  private static maxStringSize = DEFAULT_MAX_STRING_SIZE
  private static maxBase64Size = DEFAULT_MAX_BASE64_SIZE

  static setMaxBufferSize(size: number): void {
    if (size <= 0) {
      throw new Error('Max buffer size must be positive')
    }
    this.maxBufferSize = size
  }

  static getMaxBufferSize(): number {
    return this.maxBufferSize
  }

  static setMaxStringSize(size: number): void {
    if (size <= 0) {
      throw new Error('Max string size must be positive')
    }
    this.maxStringSize = size
  }

  static getMaxStringSize(): number {
    return this.maxStringSize
  }

  static setMaxBase64Size(size: number): void {
    if (size <= 0) {
      throw new Error('Max base64 size must be positive')
    }
    this.maxBase64Size = size
  }

  static getMaxBase64Size(): number {
    return this.maxBase64Size
  }
}
