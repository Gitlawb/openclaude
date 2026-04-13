import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js';
import React from 'react';
import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../../types/command.js';
import { checkOverageGate, confirmOverage, launchRemoteReview } from './reviewRemote.js';
import { UltrareviewOverageDialog } from './UltrareviewOverageDialog.js';
function contentBlocksToString(blocks: ContentBlockParam[]): string {
  return blocks.map(b => b.type === 'text' ? b.text : '').filter(Boolean).join('\n');
}
async function launchAndDone(args: string, context: Parameters<LocalJSXCommandCall>[1], onDone: LocalJSXCommandOnDone, billingNote: string, signal?: AbortSignal): Promise<void> {
  const result = await launchRemoteReview(args, context, billingNote);
  // User hit Escape during the ~5s launch — the dialog already showed
  // "cancelled" and unmounted, so skip onDone (would write to a dead
  // transcript slot) and let the caller skip confirmOverage.
  if (signal?.aborted) return;
  if (result) {
    onDone(contentBlocksToString(result), {
      shouldQuery: true
    });
  } else {
    // Precondition failures now return specific ContentBlockParam[] above.
    // null only reaches here on teleport failure (PR mode) or non-github
    // repo — both are CCR/repo connectivity issues.
    onDone('Ultrareview failed to launch the remote session. Check that this is a GitHub repo and try again.', {
      display: 'system'
    });
  }
}
export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const gate = await checkOverageGate();
  if (gate.kind === 'not-enabled') {
    onDone('Free ultrareviews used. Enable Extra Usage at https://claude.ai/settings/billing to continue.', {
      display: 'system'
    });
    return null;
  }
  if (gate.kind === 'low-balance') {
    onDone(`Balance too low to launch ultrareview ($${gate.available.toFixed(2)} available, $10 minimum). Top up at https://claude.ai/settings/billing`, {
      display: 'system'
    });
    return null;
  }
  if (gate.kind === 'needs-confirm') {
    return <UltrareviewOverageDialog onProceed={async signal => {
      await launchAndDone(args, context, onDone, ' This review bills as Extra Usage.', signal);
      // Only persist the confirmation flag after a non-aborted launch —
      // otherwise Escape-during-launch would leave the flag set and
      // skip this dialog on the next attempt.
      if (!signal.aborted) confirmOverage();
    }} onCancel={() => onDone('Ultrareview cancelled.', {
      display: 'system'
    })} />;
  }

  // gate.kind === 'proceed'
  await launchAndDone(args, context, onDone, gate.billingNote);
  return null;
};
