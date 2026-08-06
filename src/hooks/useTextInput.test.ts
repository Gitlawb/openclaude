import { describe, expect, test } from 'bun:test'

import { Cursor } from '../utils/Cursor.js'
import {
  applyCoalescedDelInput,
  prepareTextInputEvent,
} from './useTextInput.js'

const insert = (cursor: Cursor, text: string): Cursor => cursor.insert(text)

function apply(
  text: string,
  input: string,
  offset = text.length,
): ReturnType<typeof applyCoalescedDelInput> {
  return applyCoalescedDelInput(
    Cursor.fromText(text, 80, offset),
    input,
    insert,
  )
}

describe('applyCoalescedDelInput', () => {
  test('preserves the raw DEL workaround', () => {
    expect(apply('abc', '\x7f').cursor.text).toBe('ab')
  })

  test('inserts replacement text after DEL', () => {
    expect(apply('a', '\x7fă').cursor.text).toBe('ă')
  })

  test('applies text before and after DEL in source order', () => {
    expect(apply('', 'ab\x7fc').cursor.text).toBe('ac')
  })

  test('applies multiple DEL bytes in source order', () => {
    expect(apply('abc', '\x7f\x7fă').cursor.text).toBe('aă')
  })

  test('preserves text after a middle cursor', () => {
    const result = apply('abXY', '\x7fă', 2)

    expect(result.cursor.text).toBe('aăXY')
    expect(result.cursor.offset).toBe(2)
  })

  test('deletes one complete Unicode grapheme before inserting', () => {
    const graphemes = ['ă', 'a\u0306', '😀', '👨‍👩‍👧‍👦', '🇷🇴', '👍🏽']

    for (const grapheme of graphemes) {
      const initialCursor = Cursor.fromText(`${grapheme}X`, 80)
      const cursorBeforeX = Cursor.fromText(
        initialCursor.text,
        80,
        initialCursor.text.length - 1,
      )
      const result = applyCoalescedDelInput(
        cursorBeforeX,
        '\x7fă',
        insert,
      )

      expect(result.cursor.text).toBe('ăX')
      expect(result.cursor.offset).toBe(1)
    }
  })

  test('prefers token-aware deletion before inserting', () => {
    expect(apply('x [Pasted text #1]', '\x7fă').cursor.text).toBe('x ă')
  })

  test('preserves sequential token and grapheme deletion across a DEL run', () => {
    expect(apply('a [Pasted text #1]', '\x7f\x7f').cursor.text).toBe('a')
  })

  test('bulk DEL runs match repeated token-aware grapheme deletion', () => {
    const cases = [
      { text: 'abc', offset: 3 },
      { text: 'a [Pasted text #1]', offset: 'a [Pasted text #1]'.length },
      { text: 'a [Pasted text #1] X', offset: 'a [Pasted text #1]'.length },
      { text: 'a [Image #1] b', offset: 2 },
      { text: 'a [Image #1] b', offset: 'a [Image #1] '.length },
      {
        text: '👨‍👩‍👧‍👦👍🏽X',
        offset: '👨‍👩‍👧‍👦👍🏽'.length,
      },
      { text: 'a\n\u0301', offset: 2 },
      { text: 'abXY', offset: 2 },
    ]

    for (const testCase of cases) {
      for (let count = 1; count <= 4; count++) {
        let sequential = Cursor.fromText(
          testCase.text,
          80,
          testCase.offset,
        )
        for (let index = 0; index < count; index++) {
          sequential =
            sequential.deleteTokenBefore() ?? sequential.backspace()
        }

        const bulk = Cursor.fromText(
          testCase.text,
          80,
          testCase.offset,
        ).deleteManyBefore(count)
        expect({ text: bulk.text, offset: bulk.offset }).toEqual({
          text: sequential.text,
          offset: sequential.offset,
        })
      }
    }
  })

  test('bulk DEL at offset zero preserves selected image-chip deletion', () => {
    const initial = Cursor.fromText('[Image #1]x', 80, 0)
    const sequential = initial.deleteTokenBefore() ?? initial.backspace()
    const bulk = initial.deleteManyBefore(1)

    expect({ text: bulk.text, offset: bulk.offset }).toEqual({
      text: sequential.text,
      offset: sequential.offset,
    })
  })

  test('reports every deletion in a coalesced DEL run', () => {
    let deletedCount = 0
    applyCoalescedDelInput(
      Cursor.fromText('abc', 80, 3),
      '\x7f\x7f',
      insert,
      count => {
        deletedCount += count
      },
    )

    expect(deletedCount).toBe(2)
  })

  test('preserves a final insertion callback no-commit result', () => {
    const notifications: string[] = []
    const result = applyCoalescedDelInput(
      Cursor.fromText('a', 80, 1),
      '\x7f!',
      (cursor, text) => {
        notifications.push(text)
        return undefined
      },
    )

    expect(result.cursor.text).toBe('')
    expect(result.shouldCommit).toBe(false)
    expect(notifications).toEqual(['!'])
  })

  test('recommits after a DEL that follows a rejected insertion', () => {
    const notifications: string[] = []
    const result = applyCoalescedDelInput(
      Cursor.fromText('', 80, 0),
      '!\x7f',
      (_cursor, text) => {
        notifications.push(text)
        return undefined
      },
    )

    expect(notifications).toEqual(['!'])
    expect(result.cursor.text).toBe('')
    expect(result.shouldCommit).toBe(true)
  })
})

describe('prepareTextInputEvent', () => {
  test('marks text plus one trailing CR as coalesced Enter', () => {
    expect(prepareTextInputEvent('o\r')).toEqual({
      input: 'o',
      shouldSubmit: true,
    })
  })

  test('keeps lone CR as a newline without coalesced submission', () => {
    expect(prepareTextInputEvent('\r')).toEqual({
      input: '\n',
      shouldSubmit: false,
    })
  })

  test('removes a trailing CR adjacent to DEL before sequential editing', () => {
    expect(prepareTextInputEvent('\x7f\r')).toEqual({
      input: '\x7f',
      shouldSubmit: true,
    })
  })

  test('keeps replacement text and removes its coalesced trailing CR', () => {
    expect(prepareTextInputEvent('\x7fă\r')).toEqual({
      input: '\x7fă',
      shouldSubmit: true,
    })
  })

  test('converts a globally embedded CR before a later DEL', () => {
    expect(prepareTextInputEvent('a\r\x7fb')).toEqual({
      input: 'a\n\x7fb',
      shouldSubmit: false,
    })
  })

  test('strips a final CR from embedded multiline paste without submitting', () => {
    expect(prepareTextInputEvent('a\rb\r')).toEqual({
      input: 'a\nb',
      shouldSubmit: false,
    })
  })

  test('preserves backslash plus CR as a newline insertion', () => {
    expect(prepareTextInputEvent('\\\r')).toEqual({
      input: '\\\n',
      shouldSubmit: false,
    })
  })

  test('classifies backslash plus ANSI plus CR by visible text', () => {
    expect(prepareTextInputEvent('\\\x1b[0m\r')).toEqual({
      input: '\\\x1b[0m\n',
      shouldSubmit: false,
    })
  })
})
