export interface DocsNavItem {
  title: string
  href: string
}

export interface DocsNavGroup {
  group: string
  items: DocsNavItem[]
}

export const docsNav: DocsNavGroup[] = [
  {
    group: 'getting started',
    items: [
      { title: 'Overview', href: '/docs/' },
      { title: 'Installation', href: '/docs/installation/' },
      { title: 'Quickstart', href: '/docs/quickstart/' },
      { title: 'Providers', href: '/docs/providers/' },
    ],
  },
  {
    group: 'reference',
    items: [
      { title: 'Slash commands', href: '/docs/slash-commands/' },
      { title: 'CLI reference', href: '/docs/cli-reference/' },
      { title: 'Configuration', href: '/docs/configuration/' },
      { title: 'Keybindings', href: '/docs/keybindings/' },
      { title: 'Skills', href: '/docs/skills/' },
    ],
  },
]

export const docsPages: DocsNavItem[] = docsNav.flatMap(g => g.items)

export function pagerFor(href: string): { prev?: DocsNavItem; next?: DocsNavItem } {
  const i = docsPages.findIndex(p => p.href === href)
  if (i === -1) return {}
  return {
    prev: i > 0 ? docsPages[i - 1] : undefined,
    next: i < docsPages.length - 1 ? docsPages[i + 1] : undefined,
  }
}
