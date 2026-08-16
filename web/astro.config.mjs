import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

export default defineConfig({
  site: 'https://openclaude.gitlawb.com',
  trailingSlash: 'always',
  redirects: {
    '/changelog/': 'https://github.com/Gitlawb/openclaude/releases',
  },
  integrations: [sitemap()],
})
