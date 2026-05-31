import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { FORK_DIRECTIVE_PREFIX } from '../../constants/xml.js'

type Props = {
  addMargin: boolean
  param: TextBlockParam
}

// A fork-boilerplate user message carries the verbose forked-worker instruction
// block (buildChildMessage in forkSubagent.ts) followed by `Your directive: …`.
// Dumping the whole rules block into the transcript is noise; render a compact
// marker with just the directive.
export function UserForkBoilerplateMessage({ addMargin, param }: Props) {
  const text = param.text ?? ''
  const prefixIdx = text.indexOf(FORK_DIRECTIVE_PREFIX)
  const directive =
    prefixIdx === -1
      ? ''
      : text.slice(prefixIdx + FORK_DIRECTIVE_PREFIX.length).trim()
  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0}>
      <Text dimColor={true}>⑂ forked worker</Text>
      {directive ? <Text color="text">{`: ${directive}`}</Text> : null}
    </Box>
  )
}
