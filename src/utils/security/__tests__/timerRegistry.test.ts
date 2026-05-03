/**
 * Testes para timer registry
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { TimerRegistry } from '../timerRegistry.js'

describe('TimerRegistry', () => {
  let registry: TimerRegistry

  beforeEach(() => {
    registry = new TimerRegistry({
      maxTimers: 10,
      maxTimersPerCategory: 5,
      maxDelay: 10000,
      enableLogging: false,
    })
  })

  afterEach(() => {
    registry.clearAll()
  })

  describe('setTimeout', () => {
    it('deve criar timer com sucesso', () => {
      const id = registry.setTimeout(() => {}, 100)
      expect(id).toBeTruthy()
      expect(registry.getTimer(id)).toBeDefined()
    })

    it('deve executar callback', (done) => {
      let executed = false
      registry.setTimeout(() => {
        executed = true
        expect(executed).toBe(true)
        done()
      }, 10)
    })

    it('deve remover timer após execução', (done) => {
      const id = registry.setTimeout(() => {
        setTimeout(() => {
          expect(registry.getTimer(id)).toBeUndefined()
          done()
        }, 10)
      }, 10)
    })

    it('deve rejeitar delay muito grande', () => {
      expect(() => registry.setTimeout(() => {}, 20000)).toThrow(
        /delay too large/i
      )
    })

    it('deve rejeitar delay negativo', () => {
      expect(() => registry.setTimeout(() => {}, -100)).toThrow(
        /cannot be negative/i
      )
    })

    it('deve respeitar limite global', () => {
      // Criar timers em categorias diferentes para não atingir limite por categoria
      for (let i = 0; i < 10; i++) {
        registry.setTimeout(() => {}, 1000, { category: `cat${i}` })
      }
      expect(() => registry.setTimeout(() => {}, 1000, { category: 'cat11' })).toThrow(/limit exceeded/i)
    })

    it('deve respeitar limite por categoria', () => {
      for (let i = 0; i < 5; i++) {
        registry.setTimeout(() => {}, 1000, { category: 'test' })
      }
      expect(() =>
        registry.setTimeout(() => {}, 1000, { category: 'test' })
      ).toThrow(/limit exceeded.*category/i)
    })
  })

  describe('setInterval', () => {
    it('deve criar interval com sucesso', () => {
      const id = registry.setInterval(() => {}, 100)
      expect(id).toBeTruthy()
      expect(registry.getTimer(id)).toBeDefined()
    })

    it('deve executar callback múltiplas vezes', (done) => {
      let count = 0
      const id = registry.setInterval(() => {
        count++
        if (count === 3) {
          registry.clear(id)
          expect(count).toBe(3)
          done()
        }
      }, 10)
    })
  })

  describe('clear', () => {
    it('deve cancelar timer', () => {
      const id = registry.setTimeout(() => {}, 1000)
      const cleared = registry.clear(id)
      expect(cleared).toBe(true)
      expect(registry.getTimer(id)).toBeUndefined()
    })

    it('deve retornar false para ID inexistente', () => {
      const cleared = registry.clear('nonexistent')
      expect(cleared).toBe(false)
    })
  })

  describe('clearCategory', () => {
    it('deve cancelar todos timers de uma categoria', () => {
      registry.setTimeout(() => {}, 1000, { category: 'test' })
      registry.setTimeout(() => {}, 1000, { category: 'test' })
      registry.setTimeout(() => {}, 1000, { category: 'other' })

      const cleared = registry.clearCategory('test')
      expect(cleared).toBe(2)
      expect(registry.getTimersByCategory('test')).toHaveLength(0)
      expect(registry.getTimersByCategory('other')).toHaveLength(1)
    })
  })

  describe('clearAll', () => {
    it('deve cancelar todos os timers', () => {
      registry.setTimeout(() => {}, 1000)
      registry.setTimeout(() => {}, 1000)
      registry.setInterval(() => {}, 1000)

      const cleared = registry.clearAll()
      expect(cleared).toBe(3)
      expect(registry.getAllTimers()).toHaveLength(0)
    })
  })

  describe('getStats', () => {
    it('deve retornar estatísticas corretas', () => {
      registry.setTimeout(() => {}, 1000, { category: 'cat1' })
      registry.setTimeout(() => {}, 1000, { category: 'cat1' })
      registry.setInterval(() => {}, 1000, { category: 'cat2' })

      const stats = registry.getStats()
      expect(stats.total).toBe(3)
      expect(stats.timeouts).toBe(2)
      expect(stats.intervals).toBe(1)
      expect(stats.categories.cat1).toBe(2)
      expect(stats.categories.cat2).toBe(1)
    })
  })
})
