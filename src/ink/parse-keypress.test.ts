import { expect, test } from 'bun:test'

import {
  INITIAL_STATE,
  parseMultipleKeypresses,
  type ParsedKey,
  type ParsedInput,
} from './parse-keypress.ts'
import { InputEvent } from './events/input-event.ts'

function parseInputEvent(sequence: string): InputEvent {
  const [items] = parseMultipleKeypresses(INITIAL_STATE, sequence)

  expect(items).toHaveLength(1)

  const item = items[0]
  expect(item?.kind).toBe('key')

  return new InputEvent(item as ParsedKey)
}

test('treats CSI-u modifier 0 as unmodified printable input', () => {
  const event = parseInputEvent('\x1b[47;0u')

  expect(event.input).toBe('/')
  expect(event.key.ctrl).toBe(false)
  expect(event.key.meta).toBe(false)
  expect(event.key.shift).toBe(false)
  expect(event.key.super).toBe(false)
})

test('preserves printable Unicode CSI-u input', () => {
  const event = parseInputEvent('\x1b[231u')

  expect(event.input).toBe('ç')
  expect(event.key.ctrl).toBe(false)
  expect(event.key.meta).toBe(false)
  expect(event.key.shift).toBe(false)
  expect(event.key.super).toBe(false)
})

test('preserves printable Unicode CSI-u input with explicit modifier 0', () => {
  const event = parseInputEvent('\x1b[231;0u')

  expect(event.input).toBe('ç')
  expect(event.key.ctrl).toBe(false)
  expect(event.key.meta).toBe(false)
  expect(event.key.shift).toBe(false)
  expect(event.key.super).toBe(false)
})

test.each(['\x1b', '\x1b[27u', '\x1b[27;1u', '\x1b[27;1:1u', '\x1b[27;1:2u', '\x1b[27;1;27~'])(
  'recognizes Escape with fragmented terminal input: %j', sequence => {
    let state = INITIAL_STATE
    const keys: ParsedInput[] = []
    for (const byte of sequence) {
      const [items, next] = parseMultipleKeypresses(state, byte)
      state = next
      keys.push(...items)
    }
    keys.push(...parseMultipleKeypresses(state, null)[0])
    expect(keys).toHaveLength(1)
    const event = new InputEvent(keys[0] as ParsedKey)
    expect(event.key.escape).toBe(true)
    expect(event.input).toBe('')
  },
)

test('distinguishes Kitty key release and does not treat pasted escape as a key', () => {
  const [release] = parseMultipleKeypresses(INITIAL_STATE, '\x1b[27;1:3u')
  expect(release[0]).toMatchObject({ name: 'escape', eventType: 'release' })
  const event = parseInputEvent('\x1b[200~\x1b[27u\x1b[201~')
  expect(event.key.escape).toBe(false)
  expect(parseMultipleKeypresses(INITIAL_STATE, '\x1b[<64;10;10M')[0][0]).not.toMatchObject({ name: 'escape' })
})
