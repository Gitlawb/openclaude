import * as React from 'react'
import { Text } from '../ink.js'

/**
 * Inverse-highlight every occurrence of `query` in `text` (case-insensitive).
 * Used by search dialogs to show where the query matched in result rows
 * and preview panes.
 */
export function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text
  const queryLower = query.toLowerCase()
  const textLower = text.toLowerCase()
  const parts: React.ReactNode[] = []
  let offset = 0
  let idx = textLower.indexOf(queryLower, offset)
  if (idx === -1) return text
  while (idx !== -1) {
    if (idx > offset) parts.push(text.slice(offset, idx))
    parts.push(
      <Text key={idx} inverse>
        {text.slice(idx, idx + query.length)}
      </Text>,
    )
    offset = idx + query.length
    idx = textLower.indexOf(queryLower, offset)
  }
  if (offset < text.length) parts.push(text.slice(offset))
  return <>{parts}</>
}
