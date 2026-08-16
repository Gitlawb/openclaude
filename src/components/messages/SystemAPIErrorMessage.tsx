import * as React from 'react'
import { useState } from 'react'
import { Box, Text } from 'src/ink.js'
import { briefAPIErrorReason, formatAPIError } from 'src/services/api/errorUtils.js'
import type { SystemAPIErrorMessage } from 'src/types/message.js'
import { useInterval } from 'usehooks-ts'
import { CtrlOToExpand } from '../CtrlOToExpand.js'
import { MessageResponse } from '../MessageResponse.js'

const MAX_API_ERROR_CHARS = 1000

// Below this attempt count, show a single unobtrusive line instead of the
// full error block. Never render nothing: a silent retry is
// indistinguishable from a hang.
const FULL_ERROR_ATTEMPT_THRESHOLD = 4

type Props = {
  message: SystemAPIErrorMessage
  verbose: boolean
}

export function SystemAPIErrorMessage({ message, verbose }: Props) {
  const { retryAttempt, error, retryInMs, maxRetries } = message
  const compact = retryAttempt < FULL_ERROR_ATTEMPT_THRESHOLD
  const [countdownMs, setCountdownMs] = useState(0)
  const done = countdownMs >= retryInMs
  useInterval(() => setCountdownMs(ms => ms + 1000), done ? null : 1000)
  const retryInSecondsLive = Math.max(
    0,
    Math.round((retryInMs - countdownMs) / 1000),
  )

  if (compact) {
    return (
      <MessageResponse>
        <Text dimColor>
          {briefAPIErrorReason(error)} — retrying in {retryInSecondsLive}s
          {'…'} (attempt {retryAttempt}/{maxRetries})
        </Text>
      </MessageResponse>
    )
  }

  const formatted = formatAPIError(error)
  const truncated = !verbose && formatted.length > MAX_API_ERROR_CHARS
  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text color="error">
          {truncated
            ? formatted.slice(0, MAX_API_ERROR_CHARS) + '…'
            : formatted}
        </Text>
        {truncated && <CtrlOToExpand />}
        <Text dimColor>
          Retrying in {retryInSecondsLive}{' '}
          {retryInSecondsLive === 1 ? 'second' : 'seconds'}
          {'…'} (attempt {retryAttempt}/{maxRetries})
          {process.env.API_TIMEOUT_MS
            ? ` · API_TIMEOUT_MS=${process.env.API_TIMEOUT_MS}ms, try increasing it`
            : ''}
        </Text>
      </Box>
    </MessageResponse>
  )
}
