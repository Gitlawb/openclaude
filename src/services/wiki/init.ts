import { mkdir, writeFile } from 'fs/promises'
import { basename, relative } from 'path'
import { getWikiPaths } from './paths.js'
import type { WikiInitResult } from './types.js'

function buildSchemaTemplate(projectName: string): string {
  return `# OpenClaude Wiki Schema

This wiki stores durable, human-readable project knowledge for ${projectName}.

## Goals

- Keep useful project knowledge in markdown, not only in chat history
- Prefer synthesized facts over raw copy-paste
- Keep source attribution explicit
- Make pages easy for both humans and agents to update

## Structure

- \`index.md\`: top-level navigation and major topics
- \`log.md\`: append-only update log
- \`pages/\`: durable topic and architecture pages
- \`sources/\`: source ingestion notes and summaries

## Page Rules

- Keep pages focused on one topic
- Use stable headings such as:
  - \`## Summary\`
  - \`## Key Facts\`
  - \`## Relationships\`
  - \`## Open Questions\`
  - \`## Sources\`
- Add or update facts only when they are grounded in project files or explicit source notes
- Prefer editing an existing page over creating duplicates
`
}

function buildIndexTemplate(projectName: string): string {
  return `# ${projectName} Wiki

This wiki is maintained by OpenClaude as a durable project knowledge layer.

## Core Pages

- [Architecture](./pages/architecture.md)

## Sources

- Source notes live in [sources/](./sources/)

## Recent Updates

- See [log.md](./log.md)
`
}

function buildLogTemplate(timestamp: string): string {
  return `# Wiki Update Log

- ${timestamp}: Wiki initialized by OpenClaude
`
}

function buildArchitectureTemplate(projectName: string): string {
  return `# Architecture

## Summary

High-level architecture notes for ${projectName}.

## Key Facts

- This page is the starting point for durable architecture knowledge.

## Relationships

- Link this page to major subsystems as the wiki grows.

## Open Questions

- What are the most important runtime subsystems?
- Which files best represent the system architecture?

## Sources

- Wiki bootstrap
`
}

async function ensureFile(
  filePath: string,
  content: string,
  createdFiles: string[],
): Promise<void> {
  try {
    await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' })
    createdFiles.push(filePath)
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      return
    }
    throw error
  }
}

export async function initializeWiki(cwd: string): Promise<WikiInitResult> {
  const paths = getWikiPaths(cwd)
  const createdDirectories: string[] = []
  const createdFiles: string[] = []

  for (const dir of [paths.root, paths.pagesDir, paths.sourcesDir]) {
    await mkdir(dir, { recursive: true })
    createdDirectories.push(dir)
  }

  const projectName = basename(cwd)
  const timestamp = new Date().toISOString()

  await ensureFile(paths.schemaFile, buildSchemaTemplate(projectName), createdFiles)
  await ensureFile(paths.indexFile, buildIndexTemplate(projectName), createdFiles)
  await ensureFile(paths.logFile, buildLogTemplate(timestamp), createdFiles)
  await ensureFile(
    `${paths.pagesDir}/architecture.md`,
    buildArchitectureTemplate(projectName),
    createdFiles,
  )

  return {
    root: paths.root,
    createdFiles: createdFiles.map(file => relative(cwd, file)),
    createdDirectories: createdDirectories.map(dir => relative(cwd, dir)),
    alreadyExisted: createdFiles.length === 0,
  }
}
