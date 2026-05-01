// fileA — imports from fileB and fileC

import { CacheLayer, buildCache } from './fileB'
import { createStore, type StoreConfig } from './fileC'

export class AppController {
  private cache: CacheLayer
  private config: StoreConfig

  constructor(config: StoreConfig) {
    this.cache = buildCache()
    this.config = config
  }

  initialize(): void {
    const store = createStore()
    this.cache.cacheSet('primary', store)
  }

  getFromCache(key: string): unknown {
    return this.cache.cacheGet(key)
  }
}

export function startApp(config: StoreConfig): AppController {
  const app = new AppController(config)
  app.initialize()
  return app
}
