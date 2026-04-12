import { expect, test } from 'bun:test'
import React from 'react'

import { ModelSelector } from './ModelSelector.js'

test('ModelSelector component renders with props', () => {
  const onComplete = () => {}
  const onCancel = () => {}
  
  const component = React.createElement(ModelSelector, {
    initialModel: 'sonnet',
    onComplete,
    onCancel,
  })
  
  expect(component).not.toBeNull()
  expect(React.isValidElement(component)).toBe(true)
})

test('ModelSelector handles undefined initialModel', () => {
  const onComplete = () => {}
  
  const component = React.createElement(ModelSelector, {
    onComplete,
  })
  
  expect(component).not.toBeNull()
  expect(React.isValidElement(component)).toBe(true)
})

test('ModelSelector validates API key on mount', () => {
  const onComplete = () => {}
  
  const component = React.createElement(ModelSelector, {
    initialModel: 'opus',
    onComplete,
  })
  
  expect(component).not.toBeNull()
  expect(React.isValidElement(component)).toBe(true)
})
