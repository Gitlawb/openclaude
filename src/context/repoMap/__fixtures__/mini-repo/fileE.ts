// fileE — isolated, no imports from other fixture files

export interface Logger {
  log(message: string): void
  warn(message: string): void
  error(message: string): void
}

export class ConsoleLogger implements Logger {
  log(message: string): void {
    console.log(`[LOG] ${message}`)
  }

  warn(message: string): void {
    console.warn(`[WARN] ${message}`)
  }

  error(message: string): void {
    console.error(`[ERROR] ${message}`)
  }
}

export function createLogger(): Logger {
  return new ConsoleLogger()
}
