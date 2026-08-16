// fileB — imports from fileC

import { DataStore, createStore } from './fileC'

export class CacheLayer {
  private store: DataStore

  constructor() {
    this.store = createStore()
  }

  cacheGet(key: string): unknown | undefined {
    return this.store.lookup(key)
  }

  cacheSet(key: string, value: unknown): void {
    this.store.add(key, value)
  }
}

export function buildCache(): CacheLayer {
  return new CacheLayer()
}
