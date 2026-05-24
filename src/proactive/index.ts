export function isProactiveActive(): boolean {
  return false
}

export function isProactivePaused(): boolean {
  return false
}

export function activateProactive(_source: 'command' | 'runtime'): void {}

export function deactivateProactive(): void {}

export function setContextBlocked(_blocked: boolean): void {}