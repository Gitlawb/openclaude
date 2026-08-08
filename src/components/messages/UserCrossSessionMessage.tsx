/**
 * Renders user messages wrapped in <cross-session-message> tags
 * (UDS_INBOX-gated).
 *
 * The closed-source implementation renders a labeled preview of messages
 * forwarded from another local session via the unix-domain-socket inbox.
 * This open-source build ships a null-rendering component: the feature
 * flag is disabled, so UserTextMessage never reaches this branch.
 */

import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import * as React from 'react'

type Props = {
  addMargin: boolean
  param: TextBlockParam
}

export function UserCrossSessionMessage(_props: Props): React.ReactNode {
  return null
}
