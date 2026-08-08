/**
 * Inbound webhook content sanitizer (KAIROS_GITHUB_WEBHOOKS-gated).
 *
 * The closed-source implementation strips prompt-injection vectors from
 * GitHub-webhook-originated bridge messages before they are enqueued as
 * user input. This open-source build ships an inert passthrough: the
 * feature flag is disabled, so the function is never invoked.
 */

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'

/**
 * Sanitize inbound webhook-originated message content.
 * Identity passthrough in this build.
 */
export function sanitizeInboundWebhookContent<
  T extends string | Array<ContentBlockParam>,
>(content: T): T {
  return content
}
