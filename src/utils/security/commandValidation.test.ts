import { describe, expect, test } from 'bun:test'
import {
  UnsafeCommandError,
  validateHelperCommand,
  validateAndSanitizeHelperCommand,
} from './commandValidation.js'

describe('commandValidation', () => {
  describe('validateHelperCommand', () => {
    test('aceita comandos simples válidos', () => {
      expect(() =>
        validateHelperCommand('aws sts get-caller-identity', 'test'),
      ).not.toThrow()
      expect(() =>
        validateHelperCommand('/usr/bin/get-api-key', 'test'),
      ).not.toThrow()
      expect(() =>
        validateHelperCommand('/home/user/scripts/auth.sh', 'test'),
      ).not.toThrow()
    })

    test('aceita comandos com argumentos', () => {
      expect(() =>
        validateHelperCommand('aws sts get-caller-identity --profile prod', 'test'),
      ).not.toThrow()
      expect(() =>
        validateHelperCommand('/usr/bin/script --flag value', 'test'),
      ).not.toThrow()
    })

    test('rejeita comandos com ponto-e-vírgula', () => {
      expect(() =>
        validateHelperCommand('echo test; rm -rf /', 'test'),
      ).toThrow(UnsafeCommandError)
    })

    test('rejeita comandos com pipe', () => {
      expect(() =>
        validateHelperCommand('cat /etc/passwd | grep root', 'test'),
      ).toThrow(UnsafeCommandError)
    })

    test('rejeita comandos com backticks', () => {
      expect(() =>
        validateHelperCommand('echo `whoami`', 'test'),
      ).toThrow(UnsafeCommandError)
    })

    test('rejeita comandos com substituição de comando', () => {
      expect(() =>
        validateHelperCommand('echo $(whoami)', 'test'),
      ).toThrow(UnsafeCommandError)
    })

    test('rejeita comandos com redirecionamento', () => {
      expect(() =>
        validateHelperCommand('cat /etc/passwd > /tmp/evil', 'test'),
      ).toThrow(UnsafeCommandError)
      expect(() =>
        validateHelperCommand('cat < /etc/passwd', 'test'),
      ).toThrow(UnsafeCommandError)
    })

    test('rejeita comandos com null byte', () => {
      expect(() =>
        validateHelperCommand('echo test\0rm -rf /', 'test'),
      ).toThrow(UnsafeCommandError)
    })

    test('rejeita comandos com AND/OR', () => {
      expect(() =>
        validateHelperCommand('true && rm -rf /', 'test'),
      ).toThrow(UnsafeCommandError)
    })

    test('rejeita string vazia', () => {
      expect(() => validateHelperCommand('', 'test')).toThrow(
        UnsafeCommandError,
      )
    })

    test('rejeita não-string', () => {
      expect(() =>
        validateHelperCommand(null as any, 'test'),
      ).toThrow(UnsafeCommandError)
      expect(() =>
        validateHelperCommand(undefined as any, 'test'),
      ).toThrow(UnsafeCommandError)
    })
  })

  describe('validateAndSanitizeHelperCommand', () => {
    test('remove espaços em branco', () => {
      const result = validateAndSanitizeHelperCommand(
        '  /usr/bin/script  ',
        'test',
      )
      expect(result).toBe('/usr/bin/script')
    })

    test('mantém comando válido', () => {
      const cmd = 'aws sts get-caller-identity'
      const result = validateAndSanitizeHelperCommand(cmd, 'test')
      expect(result).toBe(cmd)
    })

    test('lança erro para comando inválido', () => {
      expect(() =>
        validateAndSanitizeHelperCommand('echo test; rm -rf /', 'test'),
      ).toThrow(UnsafeCommandError)
    })
  })

  describe('UnsafeCommandError', () => {
    test('contém comando no erro', () => {
      const cmd = 'echo test; rm -rf /'
      try {
        validateHelperCommand(cmd, 'test')
        expect(true).toBe(false) // não deve chegar aqui
      } catch (error) {
        expect(error).toBeInstanceOf(UnsafeCommandError)
        expect((error as UnsafeCommandError).command).toBe(cmd)
        expect((error as UnsafeCommandError).name).toBe('UnsafeCommandError')
      }
    })
  })
})
