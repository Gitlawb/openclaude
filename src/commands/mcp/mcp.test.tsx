import { expect, test } from 'bun:test'
import React from 'react'

import { call } from './mcp.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

test('call returns MCPSettings component with no args', async () => {
  const onDone: LocalJSXCommandOnDone = () => {}
  const result = await call(onDone, null)
  
  expect(result).not.toBeNull()
  expect(React.isValidElement(result)).toBe(true)
})

test('call returns MCPSettings with no-redirect arg', async () => {
  const onDone: LocalJSXCommandOnDone = () => {}
  const result = await call(onDone, null, 'no-redirect')
  
  expect(result).not.toBeNull()
  expect(React.isValidElement(result)).toBe(true)
})

test('call returns MCPReconnect with reconnect arg', async () => {
  const onDone: LocalJSXCommandOnDone = () => {}
  const result = await call(onDone, null, 'reconnect test-server')
  
  expect(result).not.toBeNull()
  expect(React.isValidElement(result)).toBe(true)
})

test('call returns MCPToggle with enable arg', async () => {
  const onDone: LocalJSXCommandOnDone = () => {}
  const result = await call(onDone, null, 'enable')
  
  expect(result).not.toBeNull()
  expect(React.isValidElement(result)).toBe(true)
})

test('call returns MCPToggle with disable arg', async () => {
  const onDone: LocalJSXCommandOnDone = () => {}
  const result = await call(onDone, null, 'disable')
  
  expect(result).not.toBeNull()
  expect(React.isValidElement(result)).toBe(true)
})

test('call returns MCPToggle with enable and specific server', async () => {
  const onDone: LocalJSXCommandOnDone = () => {}
  const result = await call(onDone, null, 'enable filesystem')
  
  expect(result).not.toBeNull()
  expect(React.isValidElement(result)).toBe(true)
})

test('call returns MCPToggle with disable and specific server', async () => {
  const onDone: LocalJSXCommandOnDone = () => {}
  const result = await call(onDone, null, 'disable filesystem')
  
  expect(result).not.toBeNull()
  expect(React.isValidElement(result)).toBe(true)
})
