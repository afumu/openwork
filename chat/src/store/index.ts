import type { App } from 'vue'
import { store } from './pinia'

export function setupStore(app: App) {
  app.use(store)
}

export { store }
export * from './modules'
