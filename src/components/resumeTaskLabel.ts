import type { CodeSession } from 'src/utils/teleport/api.js'
import { stringWidth } from '../ink/stringWidth.js'

export type ResumeTaskSessionMetadata = CodeSession & {
  timeString: string
}

const TRUNCATION_SUFFIX = '…'
const TRUNCATION_SUFFIX_WIDTH = 1

export function buildResumeTaskOptionLabel(
  timeString: string,
  title: string,
  repo: CodeSession['repo'],
  maxTimeStringLength: number,
  terminalColumns?: number,
): string {
  const paddedTime = timeString.padEnd(maxTimeStringLength, ' ')
  const baseLabel = `${paddedTime}  ${title}`

  if (!repo) {
    return truncateToWidth(baseLabel, terminalColumns)
  }

  const repoLabel = `  ${repo.owner.login}/${repo.name}`
  if (terminalColumns === undefined) {
    return `${baseLabel}${repoLabel}`
  }

  const baseLabelWidth = stringWidth(baseLabel)
  const repoLabelWidth = stringWidth(repoLabel)
  const totalWidth = baseLabelWidth + repoLabelWidth

  if (totalWidth <= terminalColumns) {
    return `${baseLabel}${repoLabel}`
  }

  // Try to fit base label + truncated repo
  const availableRepoWidth = terminalColumns - baseLabelWidth
  if (availableRepoWidth > TRUNCATION_SUFFIX_WIDTH) {
    const truncatedRepo = truncateToWidth(repoLabel, availableRepoWidth)
    return `${baseLabel}${truncatedRepo}`
  }

  // Base label too wide, truncate it (preserve time portion)
  const availableBaseWidth = terminalColumns - repoLabelWidth
  if (availableBaseWidth > TRUNCATION_SUFFIX_WIDTH) {
    return `${truncateToWidth(baseLabel, availableBaseWidth)}${repoLabel}`
  }

  // Fallback: truncate base label to terminal width (no repo)
  return truncateToWidth(baseLabel, terminalColumns)
}

function truncateToWidth(str: string, maxWidth?: number): string {
  if (maxWidth === undefined || maxWidth <= 0) {
    return str
  }
  const strWidth = stringWidth(str)
  if (strWidth <= maxWidth) {
    return str
  }

  // Binary search for the truncation point
  let low = 0
  let high = str.length
  let result = ''

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = str.slice(0, mid) + TRUNCATION_SUFFIX
    const candidateWidth = stringWidth(candidate)

    if (candidateWidth <= maxWidth) {
      result = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return result || TRUNCATION_SUFFIX
}

export function getResumeTaskOptionLabelColumns(
  terminalColumns: number,
  optionCount: number,
): number {
  const indexColumnWidth = String(optionCount).length + 2
  const rowChromeWidth = 2 + indexColumnWidth + 2

  return Math.max(0, terminalColumns - rowChromeWidth)
}

export function buildResumeTaskOptionsFromMetadata(
  sessionMetadata: ResumeTaskSessionMetadata[],
  terminalColumns: number,
): Array<{ label: string; value: string }> {
  const optionLabelColumns = getResumeTaskOptionLabelColumns(
    terminalColumns,
    sessionMetadata.length,
  )
  const maxTimeStringLength = Math.max(
    'Updated'.length,
    ...sessionMetadata.map(meta => meta.timeString.length),
  )

  return sessionMetadata.map(({ timeString, title, repo, id }) => ({
    label: buildResumeTaskOptionLabel(
      timeString,
      title,
      repo,
      maxTimeStringLength,
      optionLabelColumns,
    ),
    value: id,
  }))
}
