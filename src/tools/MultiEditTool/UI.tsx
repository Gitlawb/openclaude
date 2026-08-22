import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import * as React from 'react'
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js'
import { FilePathLink } from '../../components/FilePathLink.js'
import { Text } from '../../ink.js'
import type { Tools } from '../../Tool.js'
import type { Message, ProgressMessage } from '../../types/message.js'
import { getDisplayPath } from '../../utils/file.js'
import type { ThemeName } from '../../utils/theme.js'
import type { MultiEditEntry, MultiEditOutput } from './types.js'

export function userFacingName(
  input:
    | Partial<{
        edits: MultiEditEntry[]
      }>
    | undefined,
): string {
  return 'MultiEdit'
}

export function getToolUseSummary(
  input:
    | Partial<{
        edits: MultiEditEntry[]
      }>
    | undefined,
): string | null {
  if (!input?.edits?.length) {
    return null
  }
  const uniqueFiles = [
    ...new Set(input.edits.map(e => e.file_path).filter(Boolean)),
  ]
  if (uniqueFiles.length === 0) {
    return null
  }
  if (uniqueFiles.length === 1) {
    return getDisplayPath(uniqueFiles[0]!)
  }
  return `${uniqueFiles.length} files`
}

export function renderToolUseMessage(
  { edits }: { edits?: MultiEditEntry[] },
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!edits?.length) {
    return null
  }
  const uniqueFiles = [
    ...new Set(edits.map(e => e.file_path).filter(Boolean)),
  ]
  if (uniqueFiles.length === 0) {
    return null
  }
  return (
    <Text>
      Editing {edits.length} edit{edits.length === 1 ? '' : 's'} across{' '}
      {uniqueFiles.map((fp, i) => (
        <React.Fragment key={fp}>
          {i > 0 && ', '}
          <FilePathLink filePath={fp}>
            {verbose ? fp : getDisplayPath(fp)}
          </FilePathLink>
        </React.Fragment>
      ))}
    </Text>
  )
}

export function renderToolResultMessage(
  { editCount, filePaths }: MultiEditOutput,
  _progressMessagesForMessage: ProgressMessage[],
  {
    verbose,
  }: {
    style?: 'condensed'
    verbose: boolean
  },
): React.ReactNode {
  return (
    <Text color="success">
      Applied {editCount} edit{editCount === 1 ? '' : 's'} across{' '}
      {filePaths.length} file{filePaths.length === 1 ? '' : 's'}
      {verbose
        ? ': ' + filePaths.map(fp => getDisplayPath(fp)).join(', ')
        : ''}
    </Text>
  )
}

export function renderToolUseRejectedMessage(
  input: { edits: MultiEditEntry[] },
  options: {
    columns: number
    messages: Message[]
    progressMessagesForMessage: ProgressMessage[]
    style?: 'condensed'
    theme: ThemeName
    tools: Tools
    verbose: boolean
  },
): React.ReactElement {
  const { edits } = input
  const uniqueFiles = [
    ...new Set(edits.map(e => e.file_path).filter(Boolean)),
  ]
  return (
    <Text dimColor>
      Multi-edit rejected ({edits.length} edit{edits.length === 1 ? '' : 's'}{' '}
      across {uniqueFiles.length} file{uniqueFiles.length === 1 ? '' : 's'})
    </Text>
  )
}

export function renderToolUseErrorMessage(
  result: ToolResultBlockParam['content'],
  options: {
    progressMessagesForMessage: ProgressMessage[]
    tools: Tools
    verbose: boolean
  },
): React.ReactElement {
  const { verbose } = options
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />
}
