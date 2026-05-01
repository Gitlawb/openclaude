// fileC — the most imported module (imported by fileA and fileB)

export class DataStore {
  private items: Map<string, unknown> = new Map()

  add(key: string, value: unknown): void {
    this.items.set(key, value)
  }

  lookup(key: string): unknown | undefined {
    return this.items.get(key)
  }
}

export function createStore(): DataStore {
  return new DataStore()
}

export interface StoreConfig {
  maxSize: number
  ttl: number
}
