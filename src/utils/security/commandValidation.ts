/**
 * Validação de comandos helper para prevenir command injection
 *
 * @module security/commandValidation
 */

/**
 * Caracteres perigosos em comandos shell
 */
const SHELL_METACHARACTERS = /[;&|`$()<>]/

/**
 * Erro lançado quando comando contém caracteres perigosos
 */
export class UnsafeCommandError extends Error {
  constructor(message: string, public readonly command: string) {
    super(message)
    this.name = 'UnsafeCommandError'
  }
}

/**
 * Valida comando helper contra command injection
 *
 * @param command - Comando a validar
 * @param helperName - Nome do helper (para mensagens de erro)
 * @throws {UnsafeCommandError} Se comando contém caracteres perigosos
 */
export function validateHelperCommand(
  command: string,
  helperName: string,
): void {
  if (!command || typeof command !== 'string') {
    throw new UnsafeCommandError(
      `${helperName} must be a non-empty string`,
      command,
    )
  }

  // Verificar null bytes
  if (command.includes('\0')) {
    throw new UnsafeCommandError(
      `${helperName} contains null byte`,
      command,
    )
  }

  // Verificar se comando é path absoluto ou comando simples
  const trimmed = command.trim()

  // Permitir apenas:
  // 1. Path absoluto seguido de args: /path/to/script arg1 arg2
  // 2. Comando simples sem metacaracteres: aws sts get-caller-identity

  // Rejeitar metacaracteres shell perigosos
  if (SHELL_METACHARACTERS.test(trimmed)) {
    throw new UnsafeCommandError(
      `${helperName} contains shell metacharacters (;&|$\`<>). Use absolute path to script instead.`,
      command,
    )
  }
}

/**
 * Valida e sanitiza comando helper
 *
 * @param command - Comando a validar
 * @param helperName - Nome do helper
 * @returns Comando validado
 */
export function validateAndSanitizeHelperCommand(
  command: string,
  helperName: string,
): string {
  validateHelperCommand(command, helperName)
  return command.trim()
}
