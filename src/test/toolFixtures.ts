import type { AnyObject, Tool } from '../Tool.js'

type ToolFixtureOverrides<Input extends AnyObject, Output> = Pick<
  Tool<Input, Output>,
  'name'
> &
  Partial<Omit<Tool<Input, Output>, 'inputSchema' | 'name'>>

export function createToolFixture<
  Input extends AnyObject,
  Output = unknown,
>(
  inputSchema: Input,
  overrides: ToolFixtureOverrides<Input, Output>,
): Tool<Input, Output> {
  const { name, ...restOverrides } = overrides

  return {
    name,
    inputSchema,
    maxResultSizeChars: 0,
    async call() {
      return { data: undefined as Output }
    },
    async description() {
      return name
    },
    async prompt() {
      return ''
    },
    isConcurrencySafe() {
      return false
    },
    isEnabled() {
      return true
    },
    isReadOnly() {
      return false
    },
    async checkPermissions(input) {
      return { behavior: 'allow', updatedInput: input }
    },
    toAutoClassifierInput() {
      return ''
    },
    userFacingName() {
      return name
    },
    mapToolResultToToolResultBlockParam(content, toolUseID) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: typeof content === 'string' ? content : '',
      }
    },
    renderToolUseMessage() {
      return null
    },
    ...restOverrides,
  }
}
