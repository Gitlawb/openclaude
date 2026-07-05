import { describe, expect, test } from 'bun:test'
import {
  buildLinuxClipboardCheckCommand,
  buildLinuxClipboardSaveCommand,
  IMAGE_EXTENSION_REGEX,
  isImageFilePath,
  asImageFilePath,
  LINUX_CLIPBOARD_IMAGE_MIME_TYPES,
  PASTE_THRESHOLD,
} from './imagePaste.js'

describe('LINUX_CLIPBOARD_IMAGE_MIME_TYPES', () => {
  test('includes standard image MIME types', () => {
    expect(LINUX_CLIPBOARD_IMAGE_MIME_TYPES).toContain('image/png')
    expect(LINUX_CLIPBOARD_IMAGE_MIME_TYPES).toContain('image/jpeg')
    expect(LINUX_CLIPBOARD_IMAGE_MIME_TYPES).toContain('image/gif')
    expect(LINUX_CLIPBOARD_IMAGE_MIME_TYPES).toContain('image/webp')
    expect(LINUX_CLIPBOARD_IMAGE_MIME_TYPES).toContain('image/bmp')
  })
})

describe('buildLinuxClipboardCheckCommand', () => {
  test('includes xclip and wl-paste', () => {
    const cmd = buildLinuxClipboardCheckCommand()
    expect(cmd).toContain('xclip')
    expect(cmd).toContain('wl-paste')
  })

  test('includes all MIME types from LINUX_CLIPBOARD_IMAGE_MIME_TYPES', () => {
    const cmd = buildLinuxClipboardCheckCommand()
    for (const mimeType of LINUX_CLIPBOARD_IMAGE_MIME_TYPES) {
      // MIME types are escaped with \/ for grep
      expect(cmd).toContain(mimeType.replace('/', '\\/'))
    }
  })
})

describe('buildLinuxClipboardSaveCommand', () => {
  test('includes xclip and wl-paste with screenshot path', () => {
    const cmd = buildLinuxClipboardSaveCommand('/tmp/test.png')
    expect(cmd).toContain('xclip')
    expect(cmd).toContain('wl-paste')
    expect(cmd).toContain('/tmp/test.png')
  })
})

describe('IMAGE_EXTENSION_REGEX', () => {
  test('matches image extensions case-insensitively', () => {
    expect(IMAGE_EXTENSION_REGEX.test('photo.png')).toBe(true)
    expect(IMAGE_EXTENSION_REGEX.test('photo.PNG')).toBe(true)
    expect(IMAGE_EXTENSION_REGEX.test('photo.jpg')).toBe(true)
    expect(IMAGE_EXTENSION_REGEX.test('photo.jpeg')).toBe(true)
    expect(IMAGE_EXTENSION_REGEX.test('photo.JPEG')).toBe(true)
    expect(IMAGE_EXTENSION_REGEX.test('photo.gif')).toBe(true)
    expect(IMAGE_EXTENSION_REGEX.test('photo.webp')).toBe(true)
  })

  test('does not match non-image extensions', () => {
    expect(IMAGE_EXTENSION_REGEX.test('file.txt')).toBe(false)
    expect(IMAGE_EXTENSION_REGEX.test('file.bmp')).toBe(false)
    expect(IMAGE_EXTENSION_REGEX.test('file.tiff')).toBe(false)
  })
})

describe('PASTE_THRESHOLD', () => {
  test('is a positive number', () => {
    expect(PASTE_THRESHOLD).toBeGreaterThan(0)
  })
})

describe('isImageFilePath', () => {
  test('returns true for image file paths', () => {
    expect(isImageFilePath('/Users/foo/photo.png')).toBe(true)
    expect(isImageFilePath('C:\\Users\\foo\\photo.jpg')).toBe(true)
    expect(isImageFilePath('photo.jpeg')).toBe(true)
    expect(isImageFilePath('image.GIF')).toBe(true)
  })

  test('returns false for non-image file paths', () => {
    expect(isImageFilePath('/Users/foo/document.txt')).toBe(false)
    expect(isImageFilePath('C:\\Users\\foo\\readme.md')).toBe(false)
    expect(isImageFilePath('plain text')).toBe(false)
  })

  test('handles quoted paths', () => {
    expect(isImageFilePath('"/Users/foo/photo.png"')).toBe(true)
    expect(isImageFilePath("'/Users/foo/photo.png'")).toBe(true)
  })

  test('handles paths with spaces', () => {
    expect(isImageFilePath('/Users/foo/my photo.png')).toBe(true)
  })
})

describe('asImageFilePath', () => {
  test('returns cleaned path for valid image paths', () => {
    expect(asImageFilePath('/Users/foo/photo.png')).toBe('/Users/foo/photo.png')
    expect(asImageFilePath('"C:\\Users\\foo\\photo.jpg"')).toBe(
      process.platform === 'win32'
        ? 'C:\\Users\\foo\\photo.jpg'
        : 'C:Usersfoophoto.jpg',
    )
  })

  test('returns null for non-image paths', () => {
    expect(asImageFilePath('/Users/foo/document.txt')).toBeNull()
    expect(asImageFilePath('plain text')).toBeNull()
  })

  test('trims whitespace', () => {
    expect(asImageFilePath('  /Users/foo/photo.png  ')).toBe(
      '/Users/foo/photo.png',
    )
  })
})
