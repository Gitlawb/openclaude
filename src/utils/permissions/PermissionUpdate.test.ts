import { describe, expect, test } from 'bun:test'

import { getEmptyToolPermissionContext } from '../../Tool.js'
import { applyPermissionUpdate } from './PermissionUpdate.js'

describe('applyPermissionUpdate', () => {
  test('removeRules normalizes stored rules before matching removals', () => {
    const updated = applyPermissionUpdate(
      {
        ...getEmptyToolPermissionContext(),
        alwaysAllowRules: {
          userSettings: ['Bash(*)', 'Bash(npm run:*)'],
        },
      },
      {
        type: 'removeRules',
        rules: [{ toolName: 'Bash' }],
        behavior: 'allow',
        destination: 'userSettings',
      },
    )

    expect(updated.alwaysAllowRules.userSettings).toEqual(['Bash(npm run:*)'])
  })
})
