// Partner roster — mirrors the Partners section of the repo README.
// Logos are self-hosted under /public/partners/.

export interface Partner {
  name: string
  url: string
  logo: string
  /** dark-theme variant, when the primary logo doesn't read on dark */
  logoDark?: string
  /** rendered logo height in px (logos vary wildly in aspect ratio) */
  height: number
}

export const partners: Partner[] = [
  { name: 'GitLawb', url: 'https://gitlawb.com', logo: '/partners/gitlawb.png', height: 44 },
  { name: 'Bankr.bot', url: 'https://bankr.bot', logo: '/partners/bankr.svg', height: 40 },
  { name: 'Atomic Chat', url: 'https://atomic.chat/', logo: '/partners/atomic-chat-logo.png', height: 40 },
  { name: 'Xiaomi MiMo', url: 'https://mimo.mi.com', logo: '/partners/mimo.svg', height: 30 },
  { name: 'Atlas Cloud', url: 'https://www.atlascloud.ai/', logo: '/partners/atlas-cloud.png', height: 36 },
  {
    name: 'AI/ML API',
    url: 'https://aimlapi.com/',
    logo: '/partners/aimlapi-logo.svg',
    logoDark: '/partners/aimlapi-logo-dark.svg',
    height: 30,
  },
  { name: 'Novita AI', url: 'https://novita.ai/', logo: '/partners/novita-logo.png', height: 34 },
]

export const community = [
  { name: 'github', url: 'https://github.com/Gitlawb/openclaude', label: 'star the repo' },
  { name: 'discord', url: 'https://discord.gg/k68zFR6AcB', label: 'join the discord' },
  { name: 'x', url: 'https://x.com/gitlawb', label: 'follow @gitlawb' },
  { name: 'discussions', url: 'https://github.com/Gitlawb/openclaude/discussions', label: 'open a discussion' },
  { name: 'trendshift', url: 'https://trendshift.io/repositories/25807', label: 'featured on trendshift' },
]
