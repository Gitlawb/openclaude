/**
 * Utilitário de validação de paths para prevenir path traversal
 *
 * @module security/pathValidation
 */

import * as path from 'path'
import * as fs from 'fs/promises'
import { DANGEROUS_PATH_CHARS } from '../validation.js'

/**
 * Padrões suspeitos em paths
 */
const SUSPICIOUS_PATTERNS = [
  /\.\.[/\\]/,  // Path traversal
  /^[/\\]{2,}/, // UNC paths ou múltiplas barras
  /[<>:"|?*]/,  // Caracteres inválidos no Windows
]

/**
 * Erro lançado quando path traversal é detectado
 */
export class PathTraversalError extends Error {
  constructor(message: string, public readonly attemptedPath: string) {
    super(message)
    this.name = 'PathTraversalError'
  }
}

/**
 * Erro lançado quando path contém caracteres perigosos
 */
export class DangerousPathError extends Error {
  constructor(message: string, public readonly attemptedPath: string) {
    super(message)
    this.name = 'DangerousPathError'
  }
}

/**
 * Valida e normaliza um path, garantindo que está dentro do diretório base
 *
 * @param userPath - Path fornecido pelo usuário
 * @param baseDir - Diretório base permitido
 * @returns Path normalizado e validado
 * @throws {PathTraversalError} Se path tenta sair do baseDir
 * @throws {DangerousPathError} Se path contém caracteres perigosos
 */
export function validatePath(userPath: string, baseDir: string): string {
  if (!userPath || typeof userPath !== 'string') {
    throw new DangerousPathError('Path must be a non-empty string', userPath)
  }

  if (!baseDir || typeof baseDir !== 'string') {
    throw new Error('Base directory must be a non-empty string')
  }

  // Verificar caracteres perigosos (null bytes e control chars)
  if (DANGEROUS_PATH_CHARS.test(userPath)) {
    throw new DangerousPathError(
      `Path contains dangerous control characters: ${userPath}`,
      userPath
    )
  }

  // Normalizar base directory
  const normalizedBase = path.normalize(path.resolve(baseDir))

  // Resolver path relativo ao base directory
  const resolved = path.resolve(normalizedBase, userPath)
  const normalized = path.normalize(resolved)

  // Verificar se path normalizado está dentro do base directory
  if (!normalized.startsWith(normalizedBase + path.sep) && normalized !== normalizedBase) {
    throw new PathTraversalError(
      `Path traversal detected: ${userPath} resolves outside base directory`,
      userPath
    )
  }

  return normalized
}

/**
 * Valida path sem resolver (apenas verifica padrões perigosos)
 *
 * @param userPath - Path a validar
 * @returns true se path é seguro
 */
export function isPathSafe(userPath: string): boolean {
  if (!userPath || typeof userPath !== 'string') {
    return false
  }

  if (DANGEROUS_PATH_CHARS.test(userPath)) {
    return false
  }

  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(userPath)) {
      return false
    }
  }

  return true
}

/**
 * Valida e verifica se path existe e está dentro do base directory
 *
 * @param userPath - Path fornecido pelo usuário
 * @param baseDir - Diretório base permitido
 * @returns Path normalizado se válido e existente
 * @throws {PathTraversalError} Se path tenta sair do baseDir
 * @throws {DangerousPathError} Se path contém caracteres perigosos
 * @throws {Error} Se path não existe
 */
export async function validateAndCheckPath(
  userPath: string,
  baseDir: string
): Promise<string> {
  const validated = validatePath(userPath, baseDir)

  try {
    await fs.access(validated)
    return validated
  } catch (error) {
    throw new Error(`Path does not exist or is not accessible: ${userPath}`)
  }
}

/**
 * Valida múltiplos paths de uma vez
 *
 * @param userPaths - Array de paths a validar
 * @param baseDir - Diretório base permitido
 * @returns Array de paths validados
 */
export function validatePaths(userPaths: string[], baseDir: string): string[] {
  return userPaths.map(p => validatePath(p, baseDir))
}

/**
 * Cria uma função de validação com base directory pré-configurado
 *
 * @param baseDir - Diretório base
 * @returns Função de validação
 */
export function createPathValidator(baseDir: string) {
  const normalizedBase = path.normalize(path.resolve(baseDir))

  return {
    /**
     * Valida path contra o base directory configurado
     */
    validate: (userPath: string) => validatePath(userPath, normalizedBase),

    /**
     * Valida e verifica existência
     */
    validateAndCheck: (userPath: string) =>
      validateAndCheckPath(userPath, normalizedBase),

    /**
     * Valida múltiplos paths
     */
    validateMany: (userPaths: string[]) =>
      validatePaths(userPaths, normalizedBase),

    /**
     * Retorna o base directory configurado
     */
    getBaseDir: () => normalizedBase,
  }
}

/**
 * Valida path de arquivo para escrita, garantindo que diretório pai existe
 *
 * @param userPath - Path do arquivo
 * @param baseDir - Diretório base permitido
 * @returns Path validado
 */
export async function validatePathForWrite(
  userPath: string,
  baseDir: string
): Promise<string> {
  const validated = validatePath(userPath, baseDir)
  const dirname = path.dirname(validated)

  // Verificar se diretório pai existe
  try {
    const stat = await fs.stat(dirname)
    if (!stat.isDirectory()) {
      throw new Error(`Parent path is not a directory: ${dirname}`)
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Parent directory does not exist: ${dirname}`)
    }
    throw error
  }

  return validated
}

/**
 * Extrai nome de arquivo seguro removendo caracteres perigosos
 *
 * @param filename - Nome do arquivo
 * @returns Nome de arquivo sanitizado
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Filename must be a non-empty string')
  }

  // Remover path separators
  let sanitized = filename.replace(/[/\\]/g, '_')

  // Remover caracteres perigosos
  sanitized = sanitized.replace(/[<>:"|?*\x00-\x1F]/g, '_')

  // Remover dots no início (arquivos ocultos podem ser perigosos)
  sanitized = sanitized.replace(/^\.+/, '')

  // Limitar tamanho (255 é limite comum em filesystems)
  if (sanitized.length > 255) {
    const ext = path.extname(sanitized)
    const base = path.basename(sanitized, ext)
    sanitized = base.substring(0, 255 - ext.length) + ext
  }

  if (!sanitized) {
    throw new Error('Filename becomes empty after sanitization')
  }

  return sanitized
}

/**
 * Verifica se path está dentro de um dos diretórios permitidos
 *
 * @param userPath - Path a verificar
 * @param allowedDirs - Lista de diretórios permitidos
 * @returns true se path está em algum diretório permitido
 */
export function isPathInAllowedDirs(
  userPath: string,
  allowedDirs: string[]
): boolean {
  const normalized = path.normalize(path.resolve(userPath))

  return allowedDirs.some(dir => {
    const normalizedDir = path.normalize(path.resolve(dir))
    return (
      normalized.startsWith(normalizedDir + path.sep) ||
      normalized === normalizedDir
    )
  })
}
