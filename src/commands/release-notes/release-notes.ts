import type { LocalCommandResult } from '../../types/command.js'
import {
  fetchReleaseNotesForVersion,
  fetchAndStoreChangelog,
  formatReleaseNotesForDisplay,
  getReleaseNotesForVersion,
  getStoredChangelog,
} from '../../utils/releaseNotes.js'
import { getReleaseTagUrl, publicBuildVersion } from '../../utils/version.js'

async function getCurrentReleaseNotes(): Promise<string[]> {
  try {
    const freshNotes = await fetchReleaseNotesForVersion(publicBuildVersion)
    if (freshNotes.length > 0) {
      return freshNotes
    }
  } catch {
    // Fall back to cached notes below.
  }

  try {
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(rej => rej(new Error('Timeout')), 1500, reject)
    })

    await Promise.race([fetchAndStoreChangelog(), timeoutPromise])
  } catch {
    // Fall back to cached notes below.
  }

  return getReleaseNotesForVersion(
    publicBuildVersion,
    await getStoredChangelog(),
  )
}

export async function call(): Promise<LocalCommandResult> {
  const url = getReleaseTagUrl(publicBuildVersion)
  const notes = await getCurrentReleaseNotes()

  if (notes.length > 0) {
    return {
      type: 'text',
      value: `Release notes for ${publicBuildVersion}:\n${formatReleaseNotesForDisplay(notes)}\n\nFull release page: ${url}`,
    }
  }

  return {
    type: 'text',
    value: `Release notes: ${url}`,
  }
}
