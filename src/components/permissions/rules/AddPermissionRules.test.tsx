import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import React from 'react'

import { render } from '../../../ink.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../../test/sharedMutationLock.js'
import * as permissionUpdateModule from '../../../utils/permissions/PermissionUpdate.js'
import * as customSelectModule from '../../../components/CustomSelect/select.js'

type SelectProps = {
  onChange(value: string): void
}

let selectProps: SelectProps | undefined
let persistPermissionUpdateSpy: ReturnType<typeof spyOn>

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error('Timed out waiting for permission rule test condition')
}

beforeEach(async () => {
  await acquireSharedMutationLock(
    'components/permissions/rules/AddPermissionRules.test.tsx',
  )
  selectProps = undefined
  spyOn(customSelectModule, 'Select').mockImplementation(
    ((props: SelectProps) => {
      selectProps = props
      return null
    }) as never,
  )
  spyOn(permissionUpdateModule, 'applyPermissionUpdate').mockReturnValue(
    {} as never,
  )
  persistPermissionUpdateSpy = spyOn(
    permissionUpdateModule,
    'persistPermissionUpdate',
  ).mockReturnValue(false)
})

afterEach(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

test('failed permission persistence remains visible without advancing runtime state', async () => {
  const { AddPermissionRules } = await import(
    `./AddPermissionRules.js?failed-commit=${Date.now()}`
  )
  const onAddRules = mock(() => {})
  const setToolPermissionContext = mock(() => {})
  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode(mode: boolean): void
    ref(): void
    unref(): void
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = 120
  stdout.on('data', chunk => {
    output += chunk.toString()
  })
  const instance = await render(
    <AddPermissionRules
      onAddRules={onAddRules}
      onCancel={() => {}}
      ruleValues={[{ toolName: 'Bash', ruleContent: 'echo *' }]}
      ruleBehavior="allow"
      initialContext={{} as never}
      setToolPermissionContext={setToolPermissionContext}
    />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    },
  )

  try {
    await waitFor(() => selectProps !== undefined)
    selectProps?.onChange('userSettings')
    await Bun.sleep(50)

    expect(persistPermissionUpdateSpy).toHaveBeenCalled()
    expect(output).toContain('Could not save permission rules')
    expect(onAddRules).not.toHaveBeenCalled()
    expect(setToolPermissionContext).not.toHaveBeenCalled()
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})
