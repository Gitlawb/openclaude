import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'

export type VaultDoc = {
  filename: string
  title: string
  content: string
}

/**
 * Write a single markdown document to the vault.
 * Creates parent directories if needed.
 */
export function writeVaultDoc(vaultPath: string, doc: VaultDoc): void {
  const filePath = join(vaultPath, doc.filename)
  mkdirSync(dirname(filePath), { recursive: true })
  const fullContent = `# ${doc.title}\n\n${doc.content}`
  writeFileSync(filePath, fullContent, 'utf-8')
}

/**
 * Write all vault docs and generate index.md with navigation links.
 */
export function writeVaultDocs(
  vaultPath: string,
  projectName: string,
  docs: VaultDoc[],
): string[] {
  const writtenFiles: string[] = []

  for (const doc of docs) {
    writeVaultDoc(vaultPath, doc)
    writtenFiles.push(doc.filename)
  }

  const timestamp = new Date().toISOString()
  const links = docs.map((doc) => `- [${doc.title}](./${doc.filename})`).join('\n')
  const indexContent = [
    `# ${projectName} — Vault`,
    '',
    `<!-- bridge-ai generated -->`,
    '',
    `> Generated at ${timestamp}`,
    '',
    links,
    '',
  ].join('\n')

  const indexPath = join(vaultPath, 'index.md')
  mkdirSync(vaultPath, { recursive: true })
  writeFileSync(indexPath, indexContent, 'utf-8')
  writtenFiles.push('index.md')

  return writtenFiles
}

/**
 * Write a raw file to the vault (for manifest.json, config files, etc.)
 */
export function writeVaultFile(vaultPath: string, filename: string, content: string): void {
  const filePath = join(vaultPath, filename)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
}
