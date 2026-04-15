import type { IndexResult } from '../types.js'
import type { VaultDoc } from '../writer.js'

/**
 * Generate a project overview doc from README and git info.
 */
export function generateOverview(index: IndexResult): VaultDoc | null {
  const lines: string[] = []

  if (index.docs.readmeFirstParagraph) {
    lines.push(index.docs.readmeFirstParagraph)
    lines.push('')
  }

  if (index.git?.remoteUrl) {
    lines.push(`**Repository:** ${index.git.remoteUrl}`)
    lines.push('')
  }

  if (index.primaryLanguage) {
    lines.push(`**Primary language:** ${index.primaryLanguage}`)
  }

  const frameworks = index.manifests
    .map((m) => m.framework)
    .filter(Boolean)
  if (frameworks.length > 0) {
    lines.push(`**Framework:** ${[...new Set(frameworks)].join(', ')}`)
  }

  if (lines.length === 0) {
    return null
  }

  return {
    filename: 'overview.md',
    title: 'Project Overview',
    content: lines.join('\n').trim(),
  }
}

/**
 * Generate a technology stack doc from manifests and detected languages.
 */
export function generateStack(index: IndexResult): VaultDoc | null {
  if (index.manifests.length === 0) {
    return null
  }

  const lines: string[] = []

  // Languages
  if (index.languages.length > 0) {
    lines.push('## Languages')
    lines.push('')
    for (const lang of index.languages) {
      const isPrimary = lang === index.primaryLanguage ? ' (primary)' : ''
      lines.push(`- ${lang}${isPrimary}`)
    }
    lines.push('')
  }

  // Frameworks
  const frameworks = index.manifests
    .map((m) => m.framework)
    .filter(Boolean)
  if (frameworks.length > 0) {
    lines.push('## Frameworks')
    lines.push('')
    for (const fw of [...new Set(frameworks)]) {
      lines.push(`- ${fw}`)
    }
    lines.push('')
  }

  // Dependencies table (top ~20 across all manifests)
  const allDeps: Array<{ name: string; version: string; source: string }> = []
  for (const manifest of index.manifests) {
    if (!manifest.dependencies) continue
    const source = manifest.type
    for (const [name, version] of Object.entries(manifest.dependencies)) {
      allDeps.push({ name, version, source })
    }
  }

  if (allDeps.length > 0) {
    const top = allDeps.slice(0, 20)
    lines.push('## Key Dependencies')
    lines.push('')
    lines.push('| Package | Version | Source |')
    lines.push('| ------- | ------- | ------ |')
    for (const dep of top) {
      lines.push(`| ${dep.name} | ${dep.version} | ${dep.source} |`)
    }
    lines.push('')
  }

  if (lines.length === 0) {
    return null
  }

  return {
    filename: 'stack.md',
    title: 'Technology Stack',
    content: lines.join('\n').trim(),
  }
}

/**
 * Generate an architecture doc from directory structure.
 */
export function generateArchitecture(index: IndexResult): VaultDoc | null {
  if (index.structure.topLevelDirs.length === 0) {
    return null
  }

  const lines: string[] = []

  // Monorepo indicator
  if (index.structure.isMonorepo) {
    lines.push('> This project is a **monorepo**.')
    lines.push('')
  }

  // Directory listing
  lines.push('## Top-Level Directories')
  lines.push('')
  for (const dir of index.structure.topLevelDirs) {
    lines.push(`- \`${dir}/\``)
  }
  lines.push('')

  // Entry points
  if (index.structure.entryPoints.length > 0) {
    lines.push('## Entry Points')
    lines.push('')
    for (const entry of index.structure.entryPoints) {
      lines.push(`- \`${entry}\``)
    }
    lines.push('')
  }

  // Workspaces
  if (index.structure.workspaces && index.structure.workspaces.length > 0) {
    lines.push('## Workspaces')
    lines.push('')
    for (const ws of index.structure.workspaces) {
      lines.push(`- \`${ws}\``)
    }
    lines.push('')
  }

  return {
    filename: 'architecture.md',
    title: 'Architecture',
    content: lines.join('\n').trim(),
  }
}

/**
 * Generate conventions doc from detected tooling and patterns.
 */
export function generateConventions(index: IndexResult): VaultDoc | null {
  const lines: string[] = []

  // File naming from languages
  if (index.languages.length > 0) {
    lines.push('## Languages & File Types')
    lines.push('')
    for (const lang of index.languages) {
      lines.push(`- ${lang}`)
    }
    lines.push('')
  }

  // Detect linters/formatters from dependencies
  const knownTools: Record<string, string> = {
    eslint: 'Linter',
    prettier: 'Formatter',
    biome: 'Linter & Formatter',
    ruff: 'Linter & Formatter',
    black: 'Formatter',
    stylelint: 'CSS Linter',
    oxlint: 'Linter',
    dprint: 'Formatter',
  }

  const detectedTools: Array<{ name: string; role: string }> = []
  for (const manifest of index.manifests) {
    if (!manifest.dependencies) continue
    for (const depName of Object.keys(manifest.dependencies)) {
      const baseName = depName.replace(/^@.*\//, '')
      if (knownTools[baseName] && !detectedTools.some((t) => t.name === baseName)) {
        detectedTools.push({ name: baseName, role: knownTools[baseName] })
      }
    }
  }

  if (detectedTools.length > 0) {
    lines.push('## Linters & Formatters')
    lines.push('')
    for (const tool of detectedTools) {
      lines.push(`- **${tool.name}** — ${tool.role}`)
    }
    lines.push('')
  }

  // Monorepo conventions
  if (index.structure.isMonorepo) {
    lines.push('## Monorepo')
    lines.push('')
    lines.push('This project uses a monorepo layout.')
    if (index.structure.workspaces && index.structure.workspaces.length > 0) {
      lines.push(`Workspaces: ${index.structure.workspaces.map((w) => `\`${w}\``).join(', ')}`)
    }
    lines.push('')
  }

  // Only return if we found meaningful conventions
  if (detectedTools.length === 0 && !index.structure.isMonorepo) {
    return null
  }

  return {
    filename: 'conventions.md',
    title: 'Conventions',
    content: lines.join('\n').trim(),
  }
}

/**
 * Generate testing doc from detected test info.
 */
export function generateTesting(index: IndexResult): VaultDoc | null {
  const { testing } = index
  const hasInfo =
    testing.framework ||
    testing.testDirs.length > 0 ||
    testing.testCommands.length > 0 ||
    testing.coverageConfig

  if (!hasInfo) {
    return null
  }

  const lines: string[] = []

  if (testing.framework) {
    lines.push(`**Test framework:** ${testing.framework}`)
    lines.push('')
  }

  if (testing.testDirs.length > 0) {
    lines.push('## Test Directories')
    lines.push('')
    for (const dir of testing.testDirs) {
      lines.push(`- \`${dir}\``)
    }
    lines.push('')
  }

  if (testing.testCommands.length > 0) {
    lines.push('## Test Commands')
    lines.push('')
    for (const cmd of testing.testCommands) {
      lines.push(`- \`${cmd}\``)
    }
    lines.push('')
  }

  if (testing.coverageConfig) {
    lines.push(`**Coverage config:** \`${testing.coverageConfig}\``)
    lines.push('')
  }

  return {
    filename: 'testing.md',
    title: 'Testing',
    content: lines.join('\n').trim(),
  }
}

/**
 * Generate commands doc from detected build/test/lint/dev commands.
 */
export function generateCommands(index: IndexResult): VaultDoc | null {
  const { commands } = index

  // Collect all defined commands
  const entries = Object.entries(commands).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  )

  if (entries.length === 0) {
    return null
  }

  const lines: string[] = []

  lines.push('| Command | Script |')
  lines.push('| ------- | ------ |')
  for (const [name, script] of entries) {
    lines.push(`| \`${name}\` | \`${script}\` |`)
  }

  return {
    filename: 'commands.md',
    title: 'Commands',
    content: lines.join('\n').trim(),
  }
}
