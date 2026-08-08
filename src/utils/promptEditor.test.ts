import { describe, expect, test } from 'bun:test'
import { resolveEditorCommand } from './promptEditor.js'

describe('resolveEditorCommand', () => {
  test('applies known overrides', () => {
    expect(resolveEditorCommand('code')).toBe('code -w')
    expect(resolveEditorCommand('subl')).toBe('subl --wait')
  })

  test('returns the editor name as-is when there is no override', () => {
    expect(resolveEditorCommand('vim')).toBe('vim')
    expect(resolveEditorCommand('nano')).toBe('nano')
  })

  // $VISUAL / $EDITOR are arbitrary strings. A name that collides with an
  // Object.prototype member must fall through to the literal name, not resolve
  // to an inherited member — otherwise the exec command becomes a stringified
  // function ("function Object() { [native code] }") / "[object Object]".
  test.each(['constructor', '__proto__', 'hasOwnProperty', 'toString'])(
    'does not leak a prototype member for editor name %s',
    (editor) => {
      const command = resolveEditorCommand(editor)
      expect(command).toBe(editor)
      expect(typeof command).toBe('string')
    },
  )
})
