// Content for the Hawat bundled skills.
// Each .md file is inlined as a string at build time via Bun's text loader.

import checkpointMd from './hawat/checkpoint.md'
import docSyncMd from './hawat/doc-sync.md'
import exploreMd from './hawat/explore.md'
import incrementalRefactorMd from './hawat/incremental-refactor.md'
import lspMd from './hawat/lsp.md'
import orchestrateMd from './hawat/orchestrate.md'
import refactorMd from './hawat/refactor.md'
import referenceMd from './hawat/reference.md'
import skillMd from './hawat/SKILL.md'
import tddMd from './hawat/tdd.md'
import validateMd from './hawat/validate.md'

export const CHECKPOINT_CONTENT: string = checkpointMd
export const DOC_SYNC_CONTENT: string = docSyncMd
export const EXPLORE_CONTENT: string = exploreMd
export const INCREMENTAL_REFACTOR_CONTENT: string = incrementalRefactorMd
export const LSP_CONTENT: string = lspMd
export const ORCHESTRATE_CONTENT: string = orchestrateMd
export const REFACTOR_CONTENT: string = refactorMd
export const REFERENCE_CONTENT: string = referenceMd
export const SKILL_CONTENT: string = skillMd
export const TDD_CONTENT: string = tddMd
export const VALIDATE_CONTENT: string = validateMd

/** Files to extract to disk for on-demand reference. */
export const HAWAT_FILES: Record<string, string> = {
  'reference.md': referenceMd,
}
