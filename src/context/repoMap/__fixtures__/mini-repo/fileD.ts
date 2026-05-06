// fileD — imports from fileA

import { AppController, startApp } from './fileA'

export function runApp(): void {
  const controller: AppController = startApp({ maxSize: 100, ttl: 3600 })
  const result = controller.getFromCache('test')
  console.log(result)
}
