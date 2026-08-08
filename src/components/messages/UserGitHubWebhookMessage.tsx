/**
 * Renders user messages wrapped in <github-webhook-activity> tags
 * (KAIROS_GITHUB_WEBHOOKS-gated).
 *
 * The closed-source implementation renders a compact summary of the
 * GitHub webhook event that triggered the message. This open-source
 * build ships a null-rendering component: the feature flag is disabled,
 * so UserTextMessage never reaches this branch.
 */

import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import * as React from 'react'

type Props = {
  addMargin: boolean
  param: TextBlockParam
}

export function UserGitHubWebhookMessage(_props: Props): React.ReactNode {
  return null
}
