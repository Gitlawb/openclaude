import type { IndexResult, VaultConfig, VaultManifest } from '../types.js'
import type { VaultDoc } from '../writer.js'
import { writeVaultDocs } from '../writer.js'
import { saveVaultManifest } from '../config.js'
import {
  generateOverview,
  generateStack,
  generateArchitecture,
  generateConventions,
  generateTesting,
  generateCommands,
} from './templates.js'

/**
 * Generate all vault documentation from an IndexResult and write to disk.
 *
 * Runs each template generator, filters out nulls (sections with no data),
 * writes the docs + index.md, and saves the manifest.
 *
 * Returns the list of filenames written.
 */
export function generateVaultDocs(config: VaultConfig, index: IndexResult): string[] {
  const generators = [
    generateOverview,
    generateStack,
    generateArchitecture,
    generateConventions,
    generateTesting,
    generateCommands,
  ]

  const docs: VaultDoc[] = []
  for (const gen of generators) {
    const doc = gen(index)
    if (doc) docs.push(doc)
  }

  // Write all docs + index.md
  const writtenFiles = writeVaultDocs(config.vaultPath, config.projectName, docs)

  // Save manifest
  const manifest: VaultManifest = {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider: config.provider,
    docs: writtenFiles,
  }
  saveVaultManifest(config.vaultPath, manifest)

  return writtenFiles
}
