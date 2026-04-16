// Small ref-backed localStorage wrapper. Persists on write, reads once on
// init. Intentionally synchronous — storage reads are cheap and we only
// use this for a handful of connection fields.

import { ref, watch, type Ref } from 'vue'

export function useLocalStorage(key: string, defaultValue = ''): Ref<string> {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  const state = ref<string>(stored ?? defaultValue)

  watch(state, value => {
    try {
      if (value === '') localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      // Ignore quota / private-mode errors; in-memory state still works.
    }
  })

  return state
}
