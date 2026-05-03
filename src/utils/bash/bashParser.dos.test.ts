import { describe, expect, test } from 'bun:test'
import { getParserModule } from './bashParser.js'

const parser = getParserModule()!

describe('bashParser - DoS protection', () => {
  describe('node budget limits', () => {
    test('rejeita input que excede 50k nodes', () => {
      // Gerar input que cria mais de 50k nodes
      // Cada pipe cria ~3 nodes, então 20k pipes = ~60k nodes
      const manyPipes = Array(20000).fill('echo').join(' | ')

      const result = parser.parse(manyPipes, Infinity)
      expect(result).toBeNull()
    })

    test('rejeita nesting profundo que excede budget', () => {
      // Nesting profundo cria muitos nodes
      const deepNesting = '$('.repeat(5000) + '1' + ')'.repeat(5000)

      const result = parser.parse(deepNesting, Infinity)
      expect(result).toBeNull()
    })

    test('aceita input dentro do budget', () => {
      const normalInput = 'echo hello | grep world && ls -la'

      const result = parser.parse(normalInput, Infinity)
      expect(result).not.toBeNull()
    })

    test('aceita 100 pipes (dentro do budget)', () => {
      const pipes = Array(100).fill('echo').join(' | ')

      const result = parser.parse(pipes, Infinity)
      expect(result).not.toBeNull()
    })
  })

  describe('timeout protection', () => {
    test('respeita timeout de 50ms por padrão', () => {
      // Input complexo que pode demorar
      const complex = Array(1000).fill('case x in a);;esac').join(';')

      const start = Date.now()
      const result = parser.parse(complex) // usa timeout padrão de 50ms
      const elapsed = Date.now() - start

      // Deve retornar em ~50ms ou menos
      expect(elapsed).toBeLessThan(100)
    })

    test('permite timeout customizado', () => {
      const complex = Array(500).fill('echo test').join('\n')

      const result = parser.parse(complex, 1000) // 1 segundo
      expect(result).not.toBeNull()
    })
  })

  describe('fuzzing - caracteres especiais', () => {
    test('lida com null bytes sem crash', () => {
      const withNull = 'echo\0test'

      expect(() => parser.parse(withNull, Infinity)).not.toThrow()
    })

    test('lida com caracteres unicode', () => {
      const unicode = 'echo "🔥 test 中文"'

      const result = parser.parse(unicode, Infinity)
      expect(result).not.toBeNull()
    })

    test('lida com quotes não balanceadas', () => {
      const unbalanced = 'echo "test'

      expect(() => parser.parse(unbalanced, Infinity)).not.toThrow()
    })

    test('lida com parênteses não balanceados', () => {
      const unbalanced = 'echo $((1+2)'

      expect(() => parser.parse(unbalanced, Infinity)).not.toThrow()
    })

    test('lida com input vazio', () => {
      const result = parser.parse('', Infinity)
      expect(result).not.toBeNull()
    })

    test('lida com apenas espaços', () => {
      const result = parser.parse('   \n\t  ', Infinity)
      expect(result).not.toBeNull()
    })
  })

  describe('fuzzing - edge cases', () => {
    test('lida com heredoc malformado', () => {
      const malformed = 'cat <<EOF\ntest'

      expect(() => parser.parse(malformed, Infinity)).not.toThrow()
    })

    test('lida com substituição de comando vazia', () => {
      const empty = 'echo $()'

      expect(() => parser.parse(empty, Infinity)).not.toThrow()
    })

    test('lida com array vazio', () => {
      const empty = 'arr=()'

      const result = parser.parse(empty, Infinity)
      expect(result).not.toBeNull()
    })

    test('lida com case sem patterns', () => {
      const noPatterns = 'case x in\nesac'

      expect(() => parser.parse(noPatterns, Infinity)).not.toThrow()
    })

    test('lida com for sem palavras', () => {
      const noWords = 'for x in; do echo; done'

      expect(() => parser.parse(noWords, Infinity)).not.toThrow()
    })
  })

  describe('fuzzing - combinações perigosas', () => {
    test('lida com nesting + pipes + redirects', () => {
      const complex = '$(echo test | grep x) >file 2>&1 | cat'

      const result = parser.parse(complex, Infinity)
      expect(result).not.toBeNull()
    })

    test('lida com heredoc + pipes', () => {
      const combo = 'cat <<EOF | grep test\ndata\nEOF'

      expect(() => parser.parse(combo, Infinity)).not.toThrow()
    })

    test('lida com case + substituição', () => {
      const combo = 'case $(echo x) in\na) echo;;\nesac'

      const result = parser.parse(combo, Infinity)
      expect(result).not.toBeNull()
    })

    test('lida com múltiplos níveis de quotes', () => {
      const nested = 'echo "outer \\"inner\\" outer"'

      const result = parser.parse(nested, Infinity)
      expect(result).not.toBeNull()
    })
  })

  describe('performance - input grande mas válido', () => {
    test('processa 1000 comandos simples', () => {
      const manyCommands = Array(1000).fill('echo test').join('\n')

      const start = Date.now()
      const result = parser.parse(manyCommands, Infinity)
      const elapsed = Date.now() - start

      expect(result).not.toBeNull()
      // Deve processar em menos de 1 segundo
      expect(elapsed).toBeLessThan(1000)
    })

    test('processa 100 pipes rapidamente', () => {
      const pipes = Array(100).fill('echo').join(' | ')

      const start = Date.now()
      const result = parser.parse(pipes, Infinity)
      const elapsed = Date.now() - start

      expect(result).not.toBeNull()
      // Deve processar em menos de 500ms
      expect(elapsed).toBeLessThan(500)
    })

    test('processa case com 100 patterns', () => {
      const patterns = Array(100).fill('a);;').join('\n')
      const caseStmt = `case x in\n${patterns}\nesac`

      const start = Date.now()
      const result = parser.parse(caseStmt, Infinity)
      const elapsed = Date.now() - start

      expect(result).not.toBeNull()
      expect(elapsed).toBeLessThan(500)
    })
  })

  describe('loop guards funcionando', () => {
    test('guards protegem contra loops infinitos', () => {
      // Input que poderia causar loop infinito sem guards
      // Parser deve retornar null ou resultado válido, nunca travar
      const tricky = 'while true; do echo; done'

      const start = Date.now()
      const result = parser.parse(tricky, 100)
      const elapsed = Date.now() - start

      // Deve terminar rapidamente
      expect(elapsed).toBeLessThan(200)
    })
  })
})
