import { PassThrough } from 'node:stream'
import { expect, test } from 'bun:test'
import { useEffect } from 'react'
import { createRoot, useInput } from '../../ink.js'
import { AppStateProvider } from '../../state/AppState.js'
import HistorySearchInput from './HistorySearchInput.js'

function createTestStreams(): {
  stdout: PassThrough
  stdin: PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
} {
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }

  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = 80

  return { stdout, stdin }
}

async function waitFor(
  condition: () => boolean,
  description: string,
  timeoutMs = 1000,
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) return
    await Bun.sleep(5)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

test('stops consuming input when its hidden parent disables focus', async () => {
  const { stdout, stdin } = createTestStreams()
  const changes: string[] = []
  const dispatchedInputs: string[] = []
  let committedToken = 0
  let unmounted = false
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })

  function InputDispatchProbe(): null {
    useInput(input => dispatchedInputs.push(input))
    useEffect(() => () => {
      unmounted = true
    }, [])
    return null
  }

  function CommitProbe({ token }: { token: number }): null {
    useEffect(() => {
      committedToken = token
    }, [token])
    return null
  }

  const onChange = (nextValue: string) => changes.push(nextValue)
  const render = (value: string, focus: boolean, token: number) =>
    root.render(
      <AppStateProvider>
        <HistorySearchInput
          value={value}
          onChange={onChange}
          historyFailedMatch={false}
          focus={focus}
        />
        <InputDispatchProbe />
        <CommitProbe token={token} />
      </AppStateProvider>,
    )

  render('', true, 1)
  await waitFor(() => committedToken === 1, 'focused commit')
  stdin.write('a')
  await waitFor(
    () => changes.includes('a') && dispatchedInputs.includes('a'),
    'focused input dispatch',
  )

  render('a', false, 2)
  await waitFor(() => committedToken === 2, 'unfocused commit')
  stdin.write('b')
  await waitFor(() => dispatchedInputs.includes('b'), 'unfocused input dispatch')
  expect(changes).toEqual(['a'])

  root.unmount()
  await waitFor(() => unmounted, 'input probe cleanup')
  stdin.end()
  stdout.end()
})
