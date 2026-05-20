import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import * as React from 'react'
import { UserPromptMessage } from './UserPromptMessage.js'

type Props = {
  addMargin: boolean
  param: TextBlockParam
}

export function UserForkBoilerplateMessage({
  addMargin,
  param,
}: Props): React.ReactNode {
  return <UserPromptMessage addMargin={addMargin} param={param} />
}
