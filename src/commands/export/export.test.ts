import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import React from 'react'

import type { ExportFormat } from '../../utils/exportFormats.js'

let importCounter = 0

async function importExportCommand(): Promise<typeof import('./export.js')> {
  importCounter += 1
  return import(`./export.js?export-test-${importCounter}`) as Promise<
    typeof import('./export.js')
  >
}

function defaultMessages(): unknown[] {
  return [
    {
      type: 'user',
      uuid: '00000000-0000-4000-8000-000000000001',
      timestamp: '2026-05-13T12:00:00Z',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    },
  ]
}

async function withExportTestCwd<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'openclaude-export-test-'))
  try {
    return await fn(cwd)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

async function listFiles(cwd: string): Promise<string[]> {
  return (await readdir(cwd)).sort()
}

async function runExport(args: string, messages: unknown[] = defaultMessages()): Promise<string> {
  const { call } = await importExportCommand()
  let message = ''
  const result = await call(
    value => {
      message = value ?? ''
    },
    {
      messages,
      options: { tools: [] },
    } as never,
    args,
  )
  expect(result).toBeNull()
  return message
}

async function openExportDialog(args: string, messages: unknown[] = defaultMessages()): Promise<React.ReactNode> {
  const { call } = await importExportCommand()
  return call(
    () => {},
    {
      messages,
      options: { tools: [] },
    } as never,
    args,
  )
}

describe('/export direct filename', () => {
  test('writes Markdown for .md filenames without forcing .txt', async () => {
    await withExportTestCwd(async cwd => {
      const filename = join(cwd, 'transcript.md')
      const message = await runExport(filename)

      const content = await readFile(filename, 'utf8')
      expect(content).toContain('# Conversation Export')
      expect(content).toContain('## User')
      expect(content).toContain('hello')
      expect(message).toBe(`Conversation exported to: ${filename}`)
    })
  })

  test('writes Markdown for .markdown filenames without rewriting to .md', async () => {
    await withExportTestCwd(async cwd => {
      const filename = join(cwd, 'transcript.markdown')
      await runExport(filename)

      const content = await readFile(filename, 'utf8')
      expect(content).toContain('# Conversation Export')
      expect(content).toContain('hello')
    })
  })

  test('canonicalizes .markdown to .md when --format is explicit', async () => {
    await withExportTestCwd(async cwd => {
      await runExport(`--format markdown ${join(cwd, 'transcript.markdown')}`)

      const content = await readFile(join(cwd, 'transcript.md'), 'utf8')
      expect(content).toContain('# Conversation Export')
      expect(await listFiles(cwd)).toEqual(['transcript.md'])
    })
  })

  test('writes direct absolute filenames without nesting them under cwd', async () => {
    await withExportTestCwd(async cwd => {
      const absolutePath = join(cwd, 'absolute-transcript.md')

      const message = await runExport(absolutePath)

      const content = await readFile(absolutePath, 'utf8')
      expect(content).toContain('# Conversation Export')
      expect(message).toBe(`Conversation exported to: ${absolutePath}`)
    })
  })

  test('honors quoted filenames', async () => {
    await withExportTestCwd(async cwd => {
      await runExport(`"${join(cwd, 'quoted transcript.md')}"`)

      const content = await readFile(join(cwd, 'quoted transcript.md'), 'utf8')
      expect(content).toContain('# Conversation Export')
    })
  })

  test('writes JSON for .json filenames without forcing .txt', async () => {
    await withExportTestCwd(async cwd => {
      await runExport(join(cwd, 'transcript.json'))

      const parsed = JSON.parse(await readFile(join(cwd, 'transcript.json'), 'utf8'))
      expect(parsed.version).toBe(1)
      expect(parsed.messages[0].content[0].text).toBe('hello')
    })
  })

  test('writes runtime tool results as semantic tool JSON messages', async () => {
    await withExportTestCwd(async cwd => {
      await runExport(join(cwd, 'transcript.json'), [
        {
          type: 'user',
          uuid: '00000000-0000-4000-8000-000000000002',
          timestamp: '2026-05-13T12:00:01Z',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'call-1', content: 'tool output' },
            ],
          },
        },
      ])

      const parsed = JSON.parse(await readFile(join(cwd, 'transcript.json'), 'utf8'))
      expect(parsed.messages[0].type).toBe('tool')
      expect(parsed.messages[0].role).toBe('tool')
      expect(parsed.messages[0].internalType).toBeUndefined()
      expect(parsed.messages[0].rawType).toBeUndefined()
    })
  })

  test('keeps existing extensionless filename behavior as .txt', async () => {
    await withExportTestCwd(async cwd => {
      await runExport(join(cwd, 'transcript'))

      const content = await readFile(join(cwd, 'transcript.txt'), 'utf8')
      expect(content).toContain('hello')
      expect(content).not.toContain('# Conversation Export')
      expect(content).not.toContain('"version": 1')
    })
  })

  test('keeps unknown filename extensions on the existing plain text path', async () => {
    await withExportTestCwd(async cwd => {
      await runExport(join(cwd, 'transcript.csv'))

      const content = await readFile(join(cwd, 'transcript.txt'), 'utf8')
      expect(content).toContain('hello')
      expect(content).not.toContain('# Conversation Export')
      expect(await listFiles(cwd)).toEqual(['transcript.txt'])
    })
  })

  test('--format overrides filename extension and normalizes output extension', async () => {
    await withExportTestCwd(async cwd => {
      await runExport(`--format json ${join(cwd, 'transcript.txt')}`)

      const parsed = JSON.parse(await readFile(join(cwd, 'transcript.json'), 'utf8'))
      expect(parsed.version).toBe(1)
      expect(await listFiles(cwd)).toEqual(['transcript.json'])
    })
  })

  test('-f markdown overrides filename extension at command level', async () => {
    await withExportTestCwd(async cwd => {
      await runExport(`-f markdown ${join(cwd, 'transcript.txt')}`)

      const content = await readFile(join(cwd, 'transcript.md'), 'utf8')
      expect(content).toContain('# Conversation Export')
      expect(await listFiles(cwd)).toEqual(['transcript.md'])
    })
  })

  test('flag after filename overrides extension at command level', async () => {
    await withExportTestCwd(async cwd => {
      await runExport(`${join(cwd, 'transcript')} -f json`)

      const parsed = JSON.parse(await readFile(join(cwd, 'transcript.json'), 'utf8'))
      expect(parsed.version).toBe(1)
      expect(await listFiles(cwd)).toEqual(['transcript.json'])
    })
  })

  test('keeps explicit .txt export behavior', async () => {
    await withExportTestCwd(async cwd => {
      await runExport(join(cwd, 'transcript.txt'))

      const content = await readFile(join(cwd, 'transcript.txt'), 'utf8')
      expect(content).toContain('hello')
      expect(content).not.toContain('# Conversation Export')
      expect(content).not.toContain('"version": 1')
    })
  })

  test('reports unsupported formats without writing a file', async () => {
    await withExportTestCwd(async cwd => {
      const message = await runExport(`--format xml ${join(cwd, 'transcript')}`)

      expect(message).toContain('Unsupported export format: xml')
      expect(await listFiles(cwd)).toEqual([])
    })
  })

  test('reports unsupported options without writing a file', async () => {
    await withExportTestCwd(async cwd => {
      const message = await runExport(`--formt json ${join(cwd, 'transcript')}`)

      expect(message).toContain('Unsupported export option: --formt')
      expect(await listFiles(cwd)).toEqual([])
    })
  })

  test('uses --format as the interactive dialog default when no filename is provided', async () => {
    await withExportTestCwd(async () => {
      const result = await openExportDialog('--format json')

      expect(React.isValidElement(result)).toBe(true)
      expect((result as React.ReactElement<{ defaultFormat: ExportFormat }>).props.defaultFormat).toBe('json')
    })
  })

  test('uses -f as the interactive dialog default when no filename is provided', async () => {
    await withExportTestCwd(async () => {
      const result = await openExportDialog('-f json')

      expect(React.isValidElement(result)).toBe(true)
      expect((result as React.ReactElement<{ defaultFormat: ExportFormat }>).props.defaultFormat).toBe('json')
    })
  })

  test('generates prompt-based .txt default filenames for interactive export', async () => {
    await withExportTestCwd(async () => {
      const { call } = await importExportCommand()
      const result = await call(
        () => {},
        {
          messages: [
            {
              type: 'user',
              uuid: '00000000-0000-4000-8000-000000000001',
              timestamp: '2026-05-13T12:00:00Z',
              message: { role: 'user', content: [{ type: 'text', text: 'Hello, Export World!\nsecond line' }] },
            },
          ],
          options: { tools: [] },
        } as never,
        '',
      )

      expect(React.isValidElement(result)).toBe(true)
      const defaultFilename = (result as React.ReactElement<{ defaultFilename: string }>).props.defaultFilename
      expect(defaultFilename).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}-hello-export-world\.txt$/)
    })
  })

  test('falls back to conversation timestamp .txt filenames for interactive export', async () => {
    await withExportTestCwd(async () => {
      const result = await openExportDialog('', [])

      expect(React.isValidElement(result)).toBe(true)
      const defaultFilename = (result as React.ReactElement<{ defaultFilename: string }>).props.defaultFilename
      expect(defaultFilename).toMatch(/^conversation-\d{4}-\d{2}-\d{2}-\d{6}\.txt$/)
    })
  })
})
