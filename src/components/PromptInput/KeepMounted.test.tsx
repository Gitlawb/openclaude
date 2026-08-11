import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import { expect, test } from 'bun:test'
import { useEffect } from 'react'
import { createRoot, Text } from '../../ink.js'
import { KeepMounted } from './KeepMounted.js'

function createTestStdout(): NodeJS.WriteStream {
  const stdout = new PassThrough()
  ;(stdout as unknown as { columns: number }).columns = 80
  return stdout as unknown as NodeJS.WriteStream
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

test('keeps children mounted while visibility changes', async () => {
  let mounts = 0
  let unmounts = 0
  let committedToken = 0
  const stdout = createTestStdout() as unknown as PassThrough
  let output = ''
  stdout.on('data', chunk => {
    output += chunk.toString()
  })

  function Probe() {
    useEffect(() => {
      mounts++
      return () => {
        unmounts++
      }
    }, [])
    return <Text>persistent child</Text>
  }

  function CommitProbe({ token }: { token: number }): null {
    useEffect(() => {
      committedToken = token
    }, [token])
    return null
  }

  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    patchConsole: false,
  })
  const render = (hidden: boolean, token: number) =>
    root.render(
      <>
        <KeepMounted hidden={hidden}>
          <Probe />
        </KeepMounted>
        <CommitProbe token={token} />
      </>,
    )

  render(false, 1)
  await waitFor(
    () =>
      committedToken === 1 &&
      mounts === 1 &&
      stripAnsi(output).includes('persistent child'),
    'initial mount',
  )
  expect(stripAnsi(output)).toContain('persistent child')

  output = ''
  render(true, 2)
  await waitFor(() => committedToken === 2, 'hidden commit')
  const hiddenFrame = stripAnsi(output).replaceAll('\r', '').replaceAll('\n', '')
  expect(hiddenFrame).toBe('')

  render(false, 3)
  await waitFor(
    () =>
      committedToken === 3 && stripAnsi(output).includes('persistent child'),
    'visible commit',
  )
  expect(stripAnsi(output)).toContain('persistent child')

  expect(mounts).toBe(1)
  expect(unmounts).toBe(0)

  root.unmount()
  await waitFor(() => unmounts === 1, 'unmount cleanup')
  expect(unmounts).toBe(1)
})
