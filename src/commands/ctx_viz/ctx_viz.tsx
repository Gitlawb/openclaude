import React from 'react'
import { ContextViz } from '../../components/ContextViz.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

export const call: LocalJSXCommandCall = async onDone => {
  return <ContextViz onClose={onDone} />
}
