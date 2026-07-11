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

test('keeps children mounted while visibility changes', async () => {
  let mounts = 0
  let unmounts = 0
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

  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    patchConsole: false,
  })
  const render = (hidden: boolean) =>
    root.render(
      <KeepMounted hidden={hidden}>
        <Probe />
      </KeepMounted>,
    )

  render(false)
  await Bun.sleep(10)
  expect(stripAnsi(output)).toContain('persistent child')

  output = ''
  render(true)
  await Bun.sleep(10)
  const hiddenFrame = stripAnsi(output).replaceAll('\r', '').replaceAll('\n', '')
  expect(hiddenFrame).toBe('')

  render(false)

  expect(mounts).toBe(1)
  expect(unmounts).toBe(0)

  root.unmount()
  expect(unmounts).toBe(1)
})
