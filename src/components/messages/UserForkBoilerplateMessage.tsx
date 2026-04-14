/**
 * Renders fork-boilerplate messages in a collapsed, readable format.
 *
 * When a fork worker is spawned, its first message contains instructions
 * wrapped in <fork-boilerplate>...</fork-boilerplate>. This component
 * extracts the user's directive and displays it cleanly instead of
 * showing the raw boilerplate XML.
 */

import React from 'react'
import { Box, Text } from '../../ink.js'
import { FORK_DIRECTIVE_PREFIX } from '../../constants/xml.js'

type Props = {
  addMargin: boolean
  param: { text: string }
}

export function UserForkBoilerplateMessage({ addMargin, param }: Props) {
  // Extract content between <fork-boilerplate> tags
  const match = param.text.match(
    /<fork-boilerplate>([\s\S]*?)<\/fork-boilerplate>/,
  )
  const content = match?.[1]?.trim() ?? param.text

  // Extract the user's directive from the boilerplate
  const directiveIdx = content.indexOf(FORK_DIRECTIVE_PREFIX)
  const directive =
    directiveIdx >= 0
      ? content.slice(directiveIdx + FORK_DIRECTIVE_PREFIX.length).trim()
      : content

  return (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0}>
      <Text dimColor>
        <Text bold>Fork worker</Text> — {directive}
      </Text>
    </Box>
  )
}
