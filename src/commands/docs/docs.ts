import type { LocalCommandCall } from '../../types/command.js'
import { DocEngine } from '../../services/router/docEngine.js'

export const call: LocalCommandCall = async (args: string) => {
  var cwd = process.cwd()
  var engine = new DocEngine(cwd)
  var cache = engine.getCache()
  var sub = args.trim().toLowerCase()

  if (sub === 'list') {
    var entries = cache.list()
    if (entries.length === 0) return { type: 'text', value: 'Doc cache is empty. Use /docs stack to detect your tech stack.' }
    var lines = ['## Cached Documentation', '']
    lines.push('| Library | Version | Fetched | Size |')
    lines.push('|---------|---------|---------|------|')
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i]
      var stale = cache.isStale(e.lib) ? ' (stale)' : ''
      lines.push('| ' + e.lib + stale + ' | ' + e.version + ' | ' + e.fetchedAt.slice(0, 10) + ' | ' + (e.sizeBytes / 1024).toFixed(1) + 'KB |')
    }
    return { type: 'text', value: lines.join('\n') }
  }

  if (sub === 'clear') {
    var count = cache.clear()
    return { type: 'text', value: 'Cleared ' + count + ' cached docs.' }
  }

  if (sub === 'stack') {
    var manifest = engine.detectStack()
    var depCount = Object.keys(manifest.dependencies).length
    if (depCount === 0) return { type: 'text', value: 'No dependencies detected. Is there a package.json or requirements.txt?' }
    var lines2 = ['## Detected Tech Stack', '']
    lines2.push('**Runtime:** ' + (manifest.runtime || 'unknown'))
    lines2.push('**Dependencies:** ' + depCount)
    lines2.push('')
    var depNames = Object.keys(manifest.dependencies).slice(0, 20)
    for (var j = 0; j < depNames.length; j++) {
      lines2.push('- ' + depNames[j] + '@' + manifest.dependencies[depNames[j]])
    }
    if (Object.keys(manifest.dependencies).length > 20) {
      lines2.push('- ... and ' + (Object.keys(manifest.dependencies).length - 20) + ' more')
    }
    return { type: 'text', value: lines2.join('\n') }
  }

  if (sub && sub !== 'help') {
    var doc = cache.get(sub)
    if (doc) {
      return { type: 'text', value: '## ' + sub + ' (cached)\n\n' + doc.slice(0, 2000) + (doc.length > 2000 ? '\n\n... (truncated, ' + doc.length + ' chars total)' : '') }
    }
    return { type: 'text', value: 'No cached docs for "' + sub + '". Docs are cached automatically when the router detects library usage in prompts.' }
  }

  var help = [
    '## Doc Cache',
    '',
    'The doc engine caches technical documentation to prevent hallucinated APIs.',
    '',
    '**Commands:**',
    '- /docs list \u2014 show all cached docs',
    '- /docs stack \u2014 detect project tech stack',
    '- /docs clear \u2014 wipe all cached docs',
    '- /docs <lib> \u2014 show cached doc for a specific library',
  ]
  return { type: 'text', value: help.join('\n') }
}

