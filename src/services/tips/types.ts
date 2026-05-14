import type { FileStateCache } from '../../utils/fileStateCache.js'
import type { ThemeName } from '../../utils/theme.js'

export type TipContext = {
  theme: ThemeName
  readFileState?: FileStateCache
  bashTools?: Set<string>
}

export type TipSponsor = {
  name: string
  url?: string
  label?: string
}

export type Tip = {
  id: string
  content: (ctx: TipContext) => Promise<string>
  cooldownSessions: number
  isRelevant: (ctx?: TipContext) => Promise<boolean>
  sponsor?: TipSponsor
}
