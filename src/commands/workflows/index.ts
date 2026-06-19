/**
 * /workflows — manage workflow scripts (WORKFLOW_SCRIPTS-gated).
 *
 * The closed-source implementation lists, runs, and monitors workflow
 * scripts as background tasks. This open-source build ships an inert
 * placeholder: the feature flag is disabled, so the command is never
 * registered; if invoked anyway it reports that workflows are unavailable.
 */

import type { Command, LocalCommandResult } from '../../types/command.js'

const workflows = {
  type: 'local',
  name: 'workflows',
  description: 'Manage workflow scripts',
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: () =>
    Promise.resolve({
      async call(): Promise<LocalCommandResult> {
        return {
          type: 'text',
          value: 'Workflow scripts are not available in this build.',
        }
      },
    }),
} satisfies Command

export default workflows
