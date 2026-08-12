import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import React from 'react'

import { render } from '../ink.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { createWaitForCondition } from '../test/waitForCondition.js'
import * as settingsModule from '../utils/settings/settings.js'
import * as customSelectModule from './CustomSelect/index.js'
import * as selectMultiModule from './CustomSelect/SelectMulti.js'

type ApprovalSelectProps = {
  onChange(value: 'yes_all' | 'yes' | 'no'): void
  onCancel(): void
}

type MultiselectProps = {
  onSubmit(values: string[]): void
  onCancel(): void
}

let approvalSelectProps: ApprovalSelectProps | undefined
let multiselectProps: MultiselectProps | undefined
let updateSettingsSpy: ReturnType<typeof spyOn>

const waitFor = createWaitForCondition('MCP server dialog test condition')

function createOutput(): {
  stdout: PassThrough
  stdin: PassThrough & {
    isTTY: boolean
    setRawMode(mode: boolean): void
    ref(): void
    unref(): void
  }
  getOutput(): string
} {
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
  return { stdout, stdin, getOutput: () => output }
}

beforeEach(async () => {
  await acquireSharedMutationLock('components/MCPServerDialogs.test.tsx')
  approvalSelectProps = undefined
  multiselectProps = undefined
  spyOn(customSelectModule, 'Select').mockImplementation(
    ((props: ApprovalSelectProps) => {
      approvalSelectProps = props
      return null
    }) as never,
  )
  spyOn(selectMultiModule, 'SelectMulti').mockImplementation(
    ((props: MultiselectProps) => {
      multiselectProps = props
      return null
    }) as never,
  )
  updateSettingsSpy = spyOn(
    settingsModule,
    'updateSettingsForSourceWithFreshSettings',
  ).mockReturnValue({
      error: new Error('settings file is locked'),
      written: false,
    })
})

afterEach(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

test.each(['yes', 'yes_all', 'no'] as const)(
  'single-server %s keeps the dialog open when persistence fails',
  async response => {
  const { MCPServerApprovalDialog } = await import(
    `./MCPServerApprovalDialog.js?failed-commit-${response}=${Date.now()}`
  )
  const onDone = mock(() => {})
  const { stdout, stdin, getOutput } = createOutput()
  const instance = await render(
    <MCPServerApprovalDialog serverName="calendar" onDone={onDone} />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    },
  )

  try {
    await waitFor(() => approvalSelectProps !== undefined)
    approvalSelectProps?.onChange(response)
    await waitFor(() =>
      getOutput().includes('Could not save MCP server preference'),
    )

    expect(updateSettingsSpy).toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    expect(getOutput()).toContain('Could not save MCP server preference')
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
  },
)

test.each(['submit', 'cancel'] as const)(
  'multi-server %s keeps the dialog open when persistence fails',
  async action => {
  const { MCPServerMultiselectDialog } = await import(
    `./MCPServerMultiselectDialog.js?failed-commit-${action}=${Date.now()}`
  )
  const onDone = mock(() => {})
  const { stdout, stdin, getOutput } = createOutput()
  const instance = await render(
    <MCPServerMultiselectDialog
      serverNames={['calendar', 'filesystem']}
      onDone={onDone}
    />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    },
  )

  try {
    await waitFor(() => multiselectProps !== undefined)
    if (action === 'submit') {
      multiselectProps?.onSubmit(['calendar'])
    } else {
      multiselectProps?.onCancel()
    }
    await waitFor(() =>
      getOutput().includes('Could not save MCP server preferences'),
    )

    expect(updateSettingsSpy).toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    expect(getOutput()).toContain('Could not save MCP server preferences')
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
  },
)
