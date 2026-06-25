import { describe, expect, test } from 'bun:test'

import { tryReadEditedImageAttachment } from './attachments.js'
import { ImageProcessorUnavailableError } from '../tools/FileReadTool/imageProcessor.js'
import type { readImageWithTokenBudget } from '../tools/FileReadTool/FileReadTool.js'

// Pins the chosen contract for background edited-image attachments: they DEGRADE
// (return null) on any read/compress failure instead of throwing, so a missing
// optional image processor — or any other error — never aborts the turn. The
// explicit FileReadTool path is the opposite (it surfaces ImageProcessorUnavailableError
// so the user sees the install hint); see FileReadTool.readImageWithTokenBudget.
const SECRET_PATH = '/Users/jane.doe/secret-project/edited-image.png'

describe('tryReadEditedImageAttachment', () => {
  test('degrades to null when the image processor is unavailable', async () => {
    const result = await tryReadEditedImageAttachment(SECRET_PATH, {
      read: async () => {
        throw new ImageProcessorUnavailableError()
      },
    })
    expect(result).toBeNull()
  })

  test('degrades to null on a path-bearing read error (without rethrowing)', async () => {
    const result = await tryReadEditedImageAttachment(SECRET_PATH, {
      read: async () => {
        throw new Error(`Image file is empty: ${SECRET_PATH}`)
      },
    })
    expect(result).toBeNull()
  })

  test('degrades to null when the file cannot be read (real ENOENT)', async () => {
    const result = await tryReadEditedImageAttachment(
      '/nonexistent/path/definitely-not-a-real-image-xyz.png',
    )
    expect(result).toBeNull()
  })

  test('telemetry is sanitized: no file path reaches logError or analytics', async () => {
    const logged: Error[] = []
    const tracked: Array<[string, Record<string, unknown> | undefined]> = []
    await tryReadEditedImageAttachment(SECRET_PATH, {
      // Error message intentionally carries the path — it must NOT be forwarded.
      read: async () => {
        throw new Error(`Image file is empty: ${SECRET_PATH}`)
      },
      log: err => {
        logged.push(err as Error)
      },
      track: (name, meta) => {
        tracked.push([name, meta as Record<string, unknown> | undefined])
      },
    })

    // logError received a generic, path-free error (only the error TYPE name).
    expect(logged).toHaveLength(1)
    expect(logged[0]!.message).not.toContain(SECRET_PATH)
    expect(logged[0]!.message).not.toContain('jane.doe')

    // Analytics payload carries only `ext`, never the path or the raw error.
    expect(tracked).toHaveLength(1)
    const [eventName, meta] = tracked[0]!
    expect(eventName).toBe('tengu_watched_file_compression_failed')
    expect(meta).toEqual({ ext: 'png' })
    expect(JSON.stringify(meta)).not.toContain('jane.doe')
  })

  test('returns the attachment when the read succeeds', async () => {
    const fake = {
      file: { base64: 'AAAA', type: 'image/png' },
    } as unknown as Awaited<ReturnType<typeof readImageWithTokenBudget>>
    const result = await tryReadEditedImageAttachment(SECRET_PATH, {
      read: async () => fake,
    })
    expect(result).toEqual({
      type: 'edited_image_file',
      filename: SECRET_PATH,
      content: fake,
    })
  })
})
