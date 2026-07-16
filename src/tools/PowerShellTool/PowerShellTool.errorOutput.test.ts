import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  PowerShellTool,
  appendPersistedPowerShellOutputHint,
  MAX_PERSISTED_POWERSHELL_OUTPUT_SIZE,
  persistPowerShellOutputFile,
} from './PowerShellTool.js'
import {
  generatePreview,
  PREVIEW_SIZE_BYTES,
} from '../../utils/toolResultStorage.js'

describe('PowerShellTool persisted error output', () => {
  test('uses the persisted file preview for the model-facing success result', () => {
    const fullOutput = `COMMAND CONTEXT\n${'routine output\n'.repeat(300)}FAILURE ROOT\n`
    const preview = generatePreview(fullOutput, PREVIEW_SIZE_BYTES).preview
    const mapped = PowerShellTool.mapToolResultToToolResultBlockParam(
      {
        stdout: 'captured head only',
        stderr: '',
        interrupted: false,
        persistedOutputPath: '/tmp/full-output.txt',
        persistedOutputSize: 42_100,
        persistedOutputPreview: preview,
        persistedOutputPreviewStrategy: 'head-tail',
      } as never,
      'toolu_persisted_preview',
    )

    expect(String(mapped.content)).toContain(preview)
    expect(String(mapped.content)).toContain('UTF-8-safe head and tail')
    expect(String(mapped.content)).not.toContain('complete available inline output')
    expect(Buffer.byteLength(preview, 'utf8')).toBeLessThanOrEqual(
      PREVIEW_SIZE_BYTES,
    )
  })

  test('labels a small captured-only fallback as partial, not complete', () => {
    const mapped = PowerShellTool.mapToolResultToToolResultBlockParam(
      {
        stdout: 'small captured head',
        stderr: '',
        interrupted: false,
        persistedOutputPath: '/tmp/full-output.txt',
        persistedOutputSize: 42_100,
      } as never,
      'toolu_captured_fallback',
    )

    expect(String(mapped.content)).toContain('UTF-8-safe head-only partial output')
    expect(String(mapped.content)).not.toContain('complete available inline output')
  })

  test('under-claims a supplied preview when its strategy is missing', () => {
    const mapped = PowerShellTool.mapToolResultToToolResultBlockParam(
      {
        stdout: 'captured head only',
        stderr: '',
        interrupted: false,
        persistedOutputPath: '/tmp/full-output.txt',
        persistedOutputSize: 42_100,
        persistedOutputPreview: 'preview with unknown provenance',
      } as never,
      'toolu_preview_without_strategy',
    )

    expect(String(mapped.content)).toContain('UTF-8-safe head-only partial output')
    expect(String(mapped.content)).not.toContain('UTF-8-safe head and tail')
  })

  test('hint reports a cap instead of "full output" when the roll file was truncated', () => {
    const original = MAX_PERSISTED_POWERSHELL_OUTPUT_SIZE + 4096
    const hint = appendPersistedPowerShellOutputHint('preview', '/tmp/out', original, true)

    expect(hint).not.toContain('full output')
    expect(hint).toContain('capped')
    expect(hint).toContain(`first ${MAX_PERSISTED_POWERSHELL_OUTPUT_SIZE} bytes`)
    expect(hint).toContain(`${original}-byte`)
    expect(hint).toContain('/tmp/out')
  })

  test('capped hint distinguishes preview tail bytes from saved bytes', () => {
    const hint = appendPersistedPowerShellOutputHint(
      'captured output',
      '/tmp/out',
      MAX_PERSISTED_POWERSHELL_OUTPUT_SIZE + 4096,
      true,
      'COMMAND CONTEXT\n… 4096 bytes omitted …\nFAILURE ROOT',
      'head-tail',
    )

    expect(hint).toContain('preview may include tail bytes not saved at that path')
  })

  test('hint keeps "full output" wording when the roll file fit under the cap', () => {
    const hint = appendPersistedPowerShellOutputHint('preview', '/tmp/out', 1234, false)
    expect(hint).toMatch(/full output \(1234 bytes\) saved to \/tmp\/out; read with the Read tool/)
  })

  test('bounded error preview replaces the captured head', () => {
    const captured = 'captured duplicate\n'.repeat(2_000)
    const preview = 'COMMAND CONTEXT\n… 42,000 bytes omitted …\nFAILURE ROOT'
    const hint = appendPersistedPowerShellOutputHint(
      captured,
      '/tmp/out',
      42_100,
      false,
      preview,
      'head-tail',
    )

    expect(hint).toContain(preview)
    expect(hint).not.toContain('captured duplicate')
    expect(Buffer.byteLength(hint, 'utf8')).toBeLessThan(3_000)
  })

  test('labels a head-only persisted preview honestly', () => {
    const hint = appendPersistedPowerShellOutputHint(
      'captured output',
      '/tmp/out',
      42_100,
      false,
      'COMMAND CONTEXT',
      'head-only',
    )

    expect(hint).toContain('UTF-8-safe head-only partial')
    expect(hint).not.toContain('UTF-8-safe head and tail')
  })

  test('caps the destination copy and leaves the rolled-output source intact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'powershell-persist-source-'))
    const source = join(dir, 'roll.txt')
    const body = 'x'.repeat(4096)
    writeFileSync(source, body)
    const cap = 1024
    let dest: string | undefined

    try {
      const persisted = await persistPowerShellOutputFile(source, 'powershell-persist-src-test', cap)
      expect(persisted).not.toBeNull()
      dest = persisted!.path
      expect(persisted!.size).toBe(4096)
      expect(persisted!.truncated).toBe(true)
      expect(statSync(source).size).toBe(4096)
      expect(readFileSync(source, 'utf8')).toBe(body)
      expect(statSync(dest).size).toBe(cap)
    } finally {
      if (dest && existsSync(dest)) rmSync(dest, { force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('capped destination contains exactly the first maxSize bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'powershell-persist-head-'))
    const source = join(dir, 'roll.txt')
    const cap = 2048
    const head = 'A'.repeat(cap)
    const tail = 'B'.repeat(cap)
    writeFileSync(source, head + tail)
    let dest: string | undefined

    try {
      const persisted = await persistPowerShellOutputFile(source, 'powershell-persist-head-test', cap)
      expect(persisted).not.toBeNull()
      dest = persisted!.path
      expect(persisted!.truncated).toBe(true)
      expect(persisted!.preview).toStartWith('A')
      expect(persisted!.preview).toEndWith('B'.repeat(790))
      expect(persisted!.preview).toMatch(/… \d+ bytes omitted …/)
      expect(Buffer.byteLength(persisted!.preview!, 'utf8')).toBeLessThanOrEqual(
        PREVIEW_SIZE_BYTES,
      )
      const saved = readFileSync(dest, 'utf8')
      expect(saved.length).toBe(cap)
      expect(saved).toBe(head)
      expect(saved).not.toContain('B')
    } finally {
      if (dest && existsSync(dest)) rmSync(dest, { force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('strips and reports a retained-tail Claude Code hint without changing the saved file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'powershell-persist-hint-'))
    const source = join(dir, 'roll.txt')
    const hint =
      '<claude-code-hint v="1" type="plugin" value="example@claude-plugins-official" />'
    const body = `COMMAND CONTEXT\n${'routine output\n'.repeat(300)}${hint}\nFAILURE ROOT\n`
    writeFileSync(source, body)
    let dest: string | undefined

    try {
      const persisted = await persistPowerShellOutputFile(
        source,
        'powershell-persist-hint-test',
        MAX_PERSISTED_POWERSHELL_OUTPUT_SIZE,
        'example-cli run',
      )
      expect(persisted).not.toBeNull()
      dest = persisted!.path
      expect(persisted!.preview).toContain('FAILURE ROOT')
      expect(persisted!.preview).not.toContain('<claude-code-hint')
      const marker = persisted!.preview!.match(/… (\d+) bytes omitted …/)
      expect(marker).toBeDefined()
      const displayedOutput = persisted!.preview!.replace(marker![0], '')
      expect(Number(marker![1])).toBe(
        Buffer.byteLength(body, 'utf8') -
        Buffer.byteLength(displayedOutput, 'utf8'),
      )
      expect(persisted!.previewHints).toEqual([
        {
          v: 1,
          type: 'plugin',
          value: 'example@claude-plugins-official',
          sourceCommand: 'example-cli',
        },
      ])
      expect(readFileSync(dest, 'utf8')).toBe(body)
    } finally {
      if (dest && existsSync(dest)) rmSync(dest, { force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('downgrades a complete preview when a hint line is removed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'powershell-persist-complete-hint-'))
    const source = join(dir, 'roll.txt')
    const hint =
      '<claude-code-hint v="1" type="plugin" value="example@claude-plugins-official" />'
    const body = `COMMAND CONTEXT\n${hint}\nFAILURE ROOT\n`
    writeFileSync(source, body)
    let dest: string | undefined

    try {
      const persisted = await persistPowerShellOutputFile(
        source,
        'powershell-persist-complete-hint-test',
        MAX_PERSISTED_POWERSHELL_OUTPUT_SIZE,
        'example-cli run',
      )
      expect(persisted).not.toBeNull()
      dest = persisted!.path
      expect(persisted!.previewStrategy).toBe('head-only')
      expect(persisted!.preview).not.toContain('<claude-code-hint')

      const mapped = PowerShellTool.mapToolResultToToolResultBlockParam(
        {
          stdout: 'captured head only',
          stderr: '',
          interrupted: false,
          persistedOutputPath: persisted!.path,
          persistedOutputSize: persisted!.size,
          persistedOutputPreview: persisted!.preview,
          persistedOutputPreviewStrategy: persisted!.previewStrategy,
        } as never,
        'toolu_sanitized_complete_preview',
      )
      expect(String(mapped.content)).toContain(
        'UTF-8-safe head-only partial output',
      )
      expect(String(mapped.content)).not.toContain(
        'complete available inline output',
      )
      expect(readFileSync(dest, 'utf8')).toBe(body)
    } finally {
      if (dest && existsSync(dest)) rmSync(dest, { force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
