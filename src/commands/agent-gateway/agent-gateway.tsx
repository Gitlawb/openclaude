import * as React from 'react'
import { AgentGatewayManager } from '../../components/AgentGatewayManager.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const trimmedArgs = args?.trim().toLowerCase() ?? ''

  if (
    COMMON_HELP_ARGS.includes(trimmedArgs) ||
    COMMON_INFO_ARGS.includes(trimmedArgs) ||
    trimmedArgs === 'help' ||
    trimmedArgs === '--help' ||
    trimmedArgs === '-h'
  ) {
    onDone(
      [
        'Run /agent-gateway to configure the local agent gateway.',
        '',
        'It can configure provider/model/env profiles, expose /v1/chat/completions and /v1/responses, run scheduled cron jobs, accept Telegram bot messages, install/start Open WebUI, and tune Ouroboros consciousness/evolution.',
      ].join('\n'),
      { display: 'system' },
    )
    return
  }

  return (
    <AgentGatewayManager
      mode="manage"
      onDone={message =>
        onDone(message ?? 'Agent gateway settings closed', {
          display: 'system',
        })
      }
    />
  )
}
