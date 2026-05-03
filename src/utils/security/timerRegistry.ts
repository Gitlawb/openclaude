/**
 * Registry de timers com limites para prevenir memory leaks e DoS
 *
 * @module security/timerRegistry
 */

export interface TimerOptions {
  /** ID único para o timer (opcional, gerado automaticamente se não fornecido) */
  id?: string
  /** Categoria do timer para organização e limites por categoria */
  category?: string
  /** Descrição do timer para debugging */
  description?: string
}

export interface TimerInfo {
  id: string
  type: 'timeout' | 'interval'
  category: string
  description?: string
  createdAt: number
  delay: number
  handle: NodeJS.Timeout
}

/**
 * Configuração do registry
 */
export interface TimerRegistryConfig {
  /** Número máximo de timers ativos globalmente */
  maxTimers: number
  /** Número máximo de timers por categoria */
  maxTimersPerCategory: number
  /** Delay máximo permitido em ms (previne timers muito longos) */
  maxDelay: number
  /** Habilitar logging de criação/destruição de timers */
  enableLogging: boolean
}

const DEFAULT_CONFIG: TimerRegistryConfig = {
  maxTimers: 1000,
  maxTimersPerCategory: 100,
  maxDelay: 24 * 60 * 60 * 1000, // 24 horas
  enableLogging: false,
}

/**
 * Registry centralizado de timers com proteções contra memory leaks e DoS
 */
export class TimerRegistry {
  private timers = new Map<string, TimerInfo>()
  private nextId = 0
  private config: TimerRegistryConfig

  constructor(config: Partial<TimerRegistryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Gera ID único para timer
   */
  private generateId(): string {
    return `timer_${Date.now()}_${this.nextId++}`
  }

  /**
   * Conta timers em uma categoria
   */
  private countTimersInCategory(category: string): number {
    let count = 0
    for (const timer of this.timers.values()) {
      if (timer.category === category) {
        count++
      }
    }
    return count
  }

  /**
   * Valida se pode criar novo timer
   */
  private validateCanCreate(category: string, delay: number): void {
    // Verificar limite global
    if (this.timers.size >= this.config.maxTimers) {
      throw new Error(
        `Timer limit exceeded: ${this.timers.size}/${this.config.maxTimers}`
      )
    }

    // Verificar limite por categoria
    const categoryCount = this.countTimersInCategory(category)
    if (categoryCount >= this.config.maxTimersPerCategory) {
      throw new Error(
        `Timer limit exceeded for category "${category}": ${categoryCount}/${this.config.maxTimersPerCategory}`
      )
    }

    // Verificar delay máximo
    if (delay > this.config.maxDelay) {
      throw new Error(
        `Timer delay too large: ${delay}ms (max: ${this.config.maxDelay}ms)`
      )
    }

    // Verificar delay negativo
    if (delay < 0) {
      throw new Error(`Timer delay cannot be negative: ${delay}ms`)
    }
  }

  /**
   * Registra criação de timer
   */
  private logCreate(info: TimerInfo): void {
    if (this.config.enableLogging) {
      console.debug(
        `[TimerRegistry] Created ${info.type} ${info.id} (${info.category}) - ${info.description || 'no description'}`
      )
    }
  }

  /**
   * Registra destruição de timer
   */
  private logDestroy(info: TimerInfo): void {
    if (this.config.enableLogging) {
      const lifetime = Date.now() - info.createdAt
      console.debug(
        `[TimerRegistry] Destroyed ${info.type} ${info.id} after ${lifetime}ms`
      )
    }
  }

  /**
   * Cria setTimeout com proteções
   */
  setTimeout(
    callback: () => void,
    delay: number,
    options: TimerOptions = {}
  ): string {
    const category = options.category || 'default'
    const id = options.id || this.generateId()

    this.validateCanCreate(category, delay)

    const handle = setTimeout(() => {
      // Remover do registry quando executar
      const info = this.timers.get(id)
      if (info) {
        this.timers.delete(id)
        this.logDestroy(info)
      }
      callback()
    }, delay)

    const info: TimerInfo = {
      id,
      type: 'timeout',
      category,
      description: options.description,
      createdAt: Date.now(),
      delay,
      handle,
    }

    this.timers.set(id, info)
    this.logCreate(info)

    return id
  }

  /**
   * Cria setInterval com proteções
   */
  setInterval(
    callback: () => void,
    delay: number,
    options: TimerOptions = {}
  ): string {
    const category = options.category || 'default'
    const id = options.id || this.generateId()

    this.validateCanCreate(category, delay)

    const handle = setInterval(callback, delay)

    const info: TimerInfo = {
      id,
      type: 'interval',
      category,
      description: options.description,
      createdAt: Date.now(),
      delay,
      handle,
    }

    this.timers.set(id, info)
    this.logCreate(info)

    return id
  }

  /**
   * Cancela timer por ID
   */
  clear(id: string): boolean {
    const info = this.timers.get(id)
    if (!info) {
      return false
    }

    if (info.type === 'timeout') {
      clearTimeout(info.handle)
    } else {
      clearInterval(info.handle)
    }

    this.timers.delete(id)
    this.logDestroy(info)

    return true
  }

  /**
   * Cancela todos os timers de uma categoria
   */
  clearCategory(category: string): number {
    let cleared = 0

    for (const [id, info] of this.timers.entries()) {
      if (info.category === category) {
        if (info.type === 'timeout') {
          clearTimeout(info.handle)
        } else {
          clearInterval(info.handle)
        }
        this.timers.delete(id)
        this.logDestroy(info)
        cleared++
      }
    }

    return cleared
  }

  /**
   * Cancela todos os timers
   */
  clearAll(): number {
    const count = this.timers.size

    for (const info of this.timers.values()) {
      if (info.type === 'timeout') {
        clearTimeout(info.handle)
      } else {
        clearInterval(info.handle)
      }
      this.logDestroy(info)
    }

    this.timers.clear()
    return count
  }

  /**
   * Retorna informações sobre timer específico
   */
  getTimer(id: string): TimerInfo | undefined {
    return this.timers.get(id)
  }

  /**
   * Retorna todos os timers ativos
   */
  getAllTimers(): TimerInfo[] {
    return Array.from(this.timers.values())
  }

  /**
   * Retorna timers de uma categoria
   */
  getTimersByCategory(category: string): TimerInfo[] {
    return Array.from(this.timers.values()).filter(
      info => info.category === category
    )
  }

  /**
   * Retorna estatísticas do registry
   */
  getStats() {
    const categories = new Map<string, number>()
    let timeouts = 0
    let intervals = 0

    for (const info of this.timers.values()) {
      categories.set(info.category, (categories.get(info.category) || 0) + 1)
      if (info.type === 'timeout') {
        timeouts++
      } else {
        intervals++
      }
    }

    return {
      total: this.timers.size,
      timeouts,
      intervals,
      categories: Object.fromEntries(categories),
      limits: {
        maxTimers: this.config.maxTimers,
        maxTimersPerCategory: this.config.maxTimersPerCategory,
        maxDelay: this.config.maxDelay,
      },
    }
  }

  /**
   * Verifica se há timers órfãos (muito antigos)
   */
  findOrphanedTimers(maxAge: number = 60 * 60 * 1000): TimerInfo[] {
    const now = Date.now()
    const orphaned: TimerInfo[] = []

    for (const info of this.timers.values()) {
      const age = now - info.createdAt
      if (age > maxAge) {
        orphaned.push(info)
      }
    }

    return orphaned
  }

  /**
   * Limpa timers órfãos
   */
  clearOrphanedTimers(maxAge: number = 60 * 60 * 1000): number {
    const orphaned = this.findOrphanedTimers(maxAge)

    for (const info of orphaned) {
      this.clear(info.id)
    }

    return orphaned.length
  }
}

/**
 * Instância global do registry
 */
export const globalTimerRegistry = new TimerRegistry({
  enableLogging: process.env.CLAUDE_CODE_DEBUG_TIMERS === '1',
})

/**
 * Wrappers convenientes usando o registry global
 */
export const safeSetTimeout = (
  callback: () => void,
  delay: number,
  options?: TimerOptions
): string => {
  return globalTimerRegistry.setTimeout(callback, delay, options)
}

export const safeSetInterval = (
  callback: () => void,
  delay: number,
  options?: TimerOptions
): string => {
  return globalTimerRegistry.setInterval(callback, delay, options)
}

export const safeClearTimer = (id: string): boolean => {
  return globalTimerRegistry.clear(id)
}

/**
 * Hook de cleanup para processos
 */
if (typeof process !== 'undefined') {
  const cleanup = () => {
    const cleared = globalTimerRegistry.clearAll()
    if (cleared > 0) {
      console.log(`[TimerRegistry] Cleaned up ${cleared} timers on exit`)
    }
  }

  process.on('exit', cleanup)
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}
