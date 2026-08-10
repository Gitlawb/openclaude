import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dirname, 'useCancelRequest.ts'), 'utf8')

test('cancel action and Ctrl+C retain distinct analytics sources', () => {
  expect(source).toContain("source: 'cancel_keybinding'")
  expect(source).toContain("handleCancel('cancel_keybinding', causalEventId)")
  expect(source).toContain("useKeybinding('chat:cancel', handleCancelKeybinding")
  expect(source).toContain("handleCancel('ctrl_c', causalEventId)")
  expect(source).toContain("source: 'ctrl_c'")
  expect(source).toContain("phase: isViewingTeammate ? 'teammate_view' : 'main_view'")
  expect(source).not.toContain("'escape' as AnalyticsMetadata")
})
