import { afterEach, describe, expect, mock, test } from 'bun:test'
import { randomBytes } from 'crypto'

// Mutable controls for the mocked image processor (image_processor_napi / sharp).
let mockMetadata: unknown = { width: 10, height: 10, format: 'png' }
let throwOnSharpConstruction = false
const defaultBuffer = Buffer.from('rendered')

function makeSharpInstance(): any {
  const chain: any = {}
  chain.metadata = () => Promise.resolve(mockMetadata)
  chain.resize = () => chain
  chain.jpeg = () => chain
  chain.png = () => chain
  chain.webp = () => chain
  chain.toBuffer = () => Promise.resolve(defaultBuffer)
  return chain
}

function sharpFactory(input: Buffer): any {
  if (throwOnSharpConstruction) {
    throw new Error('image_processor_napi crashed')
  }
  return makeSharpInstance()
}

// Map module paths used by imageResizer.ts.
const imageProcessorPath = '../tools/FileReadTool/imageProcessor.js'
const imageResizerPath = './imageResizer.js'

async function loadResizerModule() {
  return import(`${imageResizerPath}?t=${Date.now()}-${Math.random()}`)
}

const actualImageProcessor = await import(
  `${imageProcessorPath}?actual=${Date.now()}`
)

afterEach(() => {
  mockMetadata = { width: 10, height: 10, format: 'png' }
  throwOnSharpConstruction = false
  mock.restore()
})

// A minimal valid PNG with a 1920x1080 IHDR so the >1568px "overDim" check
// in the catch block reads true. Only the first 24 bytes matter for detection.
function makePngBuffer(width = 1920, height = 1080): Buffer {
  const buf = Buffer.alloc(64)
  buf[0] = 0x89
  buf[1] = 0x50
  buf[2] = 0x4e
  buf[3] = 0x47
  buf[4] = 0x0d
  buf[5] = 0x0a
  buf[6] = 0x1a
  buf[7] = 0x0a
  // IHDR width (bytes 16-19) and height (bytes 20-23)
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

// JPEG with a single SOF2 marker carrying the frame dimensions. The parser
// scans markers, so the byte positions of SOF itself don't matter — only the
// height (readUInt16BE at offset+5) and width (readUInt16BE at offset+7).
function makeJpegBuffer(width = 3840, height = 2160): Buffer {
  const buf = Buffer.alloc(32)
  buf[0] = 0xff
  buf[1] = 0xd8 // SOI
  // SOF2 (progressive): marker, length(2), precision(1), height(2), width(2)...
  buf[2] = 0xff
  buf[3] = 0xc2
  buf.writeUInt16BE(17, 4) // segment length
  buf[6] = 8 // precision
  buf.writeUInt16BE(height, 7)
  buf.writeUInt16BE(width, 9)
  return buf
}

// GIF logical screen descriptor: width (LE at 6-7), height (LE at 8-9).
function makeGifBuffer(width = 3000, height = 2500): Buffer {
  const buf = Buffer.alloc(24)
  buf[0] = 0x47 // G
  buf[1] = 0x49 // I
  buf[2] = 0x46 // F
  buf.writeUInt16LE(width, 6)
  buf.writeUInt16LE(height, 8)
  return buf
}

// WebP lossy (VP8) keyframe matching the parser. The VP8 chunk starts at
// byte 12; its 4-byte size field is at 16-19; the VP8 bitstream (3-byte
// start code 0x9D 0x01 0x2A) begins at byte 23; the 14-bit width is at
// bytes 26-27 and the 14-bit height at bytes 28-29 — stored directly, no
// -1 bias (RFC 6386; only VP8L uses minus-one encoding).
function makeWebpLossyBuffer(width = 3800, height = 2100): Buffer {
  const buf = Buffer.alloc(32)
  buf.write('RIFF', 0, 'ascii')
  // File size = total - 8 (RIFF header). Leave the WEBP/VP8 container intact.
  buf.writeUInt32LE(buf.length - 8, 4)
  buf.write('WEBP', 8, 'ascii')
  buf.write('VP8 ', 12, 'ascii')
  // VP8 chunk size = bytes from the bitstream onward.
  buf.writeUInt32LE(buf.length - 20, 16)
  // Start code at byte 23-25.
  buf[23] = 0x9d
  buf[24] = 0x01
  buf[25] = 0x2a
  buf.writeUInt16LE(width & 0x3fff, 26)
  buf.writeUInt16LE(height & 0x3fff, 28)
  return buf
}

// WebP extended (VP8X) header: canvas dimensions live in the VP8X chunk
// itself (bytes 24-26 width-1, 27-29 height-1, 24-bit LE), not in a VP8/VP8L
// content chunk.
function makeWebpExtendedBuffer(width = 3800, height = 2100): Buffer {
  const buf = Buffer.alloc(30)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(buf.length - 8, 4)
  buf.write('WEBP', 8, 'ascii')
  buf.write('VP8X', 12, 'ascii')
  buf.writeUInt32LE(10, 16) // VP8X chunk payload size
  // byte 20: flags, bytes 21-23: reserved
  buf.writeUIntLE((width - 1) & 0xffffff, 24, 3)
  buf.writeUIntLE((height - 1) & 0xffffff, 27, 3)
  return buf
}

// WebP lossless (VP8L) buffer: 1-byte 0x2F signature at byte 20, then the
// 32-bit transform header at byte 21 (bits [0..13] = width-1, [14..27] =
// height-1). Source: RFC 6386. Verified against sharp-encoded output.
function makeWebpLosslessBuffer(width = 2500, height = 1800): Buffer {
  const buf = Buffer.alloc(32)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(buf.length - 8, 4)
  buf.write('WEBP', 8, 'ascii')
  buf.write('VP8L', 12, 'ascii')
  buf.writeUInt32LE(buf.length - 20, 16)
  buf[20] = 0x2f
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)
  buf.writeUInt32LE(bits >>> 0, 21)
  return buf
}

describe('maybeResizeAndDownsampleImageBuffer — #1964 fixes', () => {
  test('does not throw and returns a buffer when metadata is undefined', async () => {
    mock.module(imageProcessorPath, () => ({
      ...actualImageProcessor,
      getImageProcessor: () => Promise.resolve(sharpFactory),
    }))
    const { maybeResizeAndDownsampleImageBuffer } = await loadResizerModule()

    mockMetadata = undefined
    const imageBuffer = makePngBuffer(10, 10)

    const result = await maybeResizeAndDownsampleImageBuffer(
      imageBuffer,
      imageBuffer.length,
      'png',
    )

    expect(result.buffer).toBeInstanceOf(Buffer)
    expect(result.mediaType).toBe('png')
    // dimensions are intentionally omitted when metadata is unavailable
    expect(result.dimensions).toBeUndefined()
  })

  test('metadata-less + compact many-image-oversized PNG: rejected without Canvas', async () => {
    mock.module(imageProcessorPath, () => ({
      ...actualImageProcessor,
      getImageProcessor: () => Promise.resolve(sharpFactory),
    }))
    const { maybeResizeAndDownsampleImageBuffer, ImageResizeError } =
      await loadResizerModule()

    mockMetadata = undefined
    // Compact in bytes but 3840x2160 pixels — must not slip through the
    // metadata-less branch just because it's under IMAGE_TARGET_RAW_SIZE.
    const imageBuffer = makePngBuffer(3840, 2160)

    await expect(
      maybeResizeAndDownsampleImageBuffer(
        imageBuffer,
        imageBuffer.length,
        'png',
      ),
    ).rejects.toBeInstanceOf(ImageResizeError)
  })

  test('metadata-less + compact many-image-oversized PNG: downsampled via Canvas when available', async () => {
    mock.module(imageProcessorPath, () => ({
      ...actualImageProcessor,
      getImageProcessor: () => Promise.resolve(sharpFactory),
    }))
    const { maybeResizeAndDownsampleImageBuffer } = await loadResizerModule()

    mockMetadata = undefined

    const downsampledBytes = Buffer.from('downsampled-pixels')
    const dataUrl = `data:image/png;base64,${downsampledBytes.toString('base64')}`
    const savedDocument = (globalThis as any).document
    ;(globalThis as any).document = {
      createElement: (_tag: string) => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() {} }),
        toDataURL: () => dataUrl,
      }),
      Image: class {
        onload: (() => void) | null = null
        onerror: ((e: unknown) => void) | null = null
        set src(_v: string) {
          queueMicrotask(() => this.onload?.())
        }
      },
    }

    const imageBuffer = makePngBuffer(3840, 2160)
    try {
      const result = await maybeResizeAndDownsampleImageBuffer(
        imageBuffer,
        imageBuffer.length,
        'png',
      )
      expect(result.buffer.equals(downsampledBytes)).toBe(true)
    } finally {
      ;(globalThis as any).document = savedDocument
    }
  })

  test('metadata-less + oversized: falls to lower JPEG quality until it fits', async () => {
    // Simulate a noisy image that only fits the raw target at quality <= 60.
    let lastQuality: number | undefined
    const sharpWithQuality = (input: Buffer): any => {
      const chain: any = {}
      chain.metadata = () => Promise.resolve(undefined)
      chain.resize = () => chain
      chain.jpeg = (opts: { quality?: number }) => {
        lastQuality = opts?.quality
        // quality 80 still oversized; 60 and below fit (<= 3.75MB).
        chain.toBuffer = () =>
          Promise.resolve(
            Buffer.alloc(lastQuality && lastQuality <= 60 ? 1000 : 4_000_000),
          )
        return chain
      }
      chain.png = () => chain
      chain.webp = () => chain
      if (!chain.toBuffer) chain.toBuffer = () => Promise.resolve(Buffer.alloc(1000))
      return chain
    }
    mock.module(imageProcessorPath, () => ({
      ...actualImageProcessor,
      getImageProcessor: () => Promise.resolve(sharpWithQuality),
    }))
    const { maybeResizeAndDownsampleImageBuffer } = await loadResizerModule()

    // Real screenshot bytes are always parseable, so give this a valid PNG
    // header with in-many-image-limit dimensions (unlike pure random bytes,
    // which the many-image guard now fails closed on).
    const imageBuffer = Buffer.concat([
      makePngBuffer(800, 600),
      randomBytes(4_000_000 - 64),
    ])
    const result = await maybeResizeAndDownsampleImageBuffer(
      imageBuffer,
      imageBuffer.length,
      'png',
    )

    expect(result.mediaType).toBe('jpeg')
    // Stopped at a quality that produces an in-budget buffer, not returning
    // the oversized quality-80 output.
    expect(result.buffer.length).toBeLessThanOrEqual(1_000_000)
    expect(lastQuality).toBe(60)
  })

  test('metadata-less + oversized: throws user-facing limit error when no quality fits', async () => {
    const sharpAlwaysTooBig = (input: Buffer): any => {
      const chain: any = {}
      chain.metadata = () => Promise.resolve(undefined)
      chain.resize = () => chain
      chain.jpeg = () => {
        chain.toBuffer = () => Promise.resolve(Buffer.alloc(4_000_000))
        return chain
      }
      chain.png = () => chain
      chain.webp = () => chain
      return chain
    }
    mock.module(imageProcessorPath, () => ({
      ...actualImageProcessor,
      getImageProcessor: () => Promise.resolve(sharpAlwaysTooBig),
    }))
    const { maybeResizeAndDownsampleImageBuffer, ImageResizeError } =
      await loadResizerModule()

    const imageBuffer = randomBytes(4_000_000)
    await expect(
      maybeResizeAndDownsampleImageBuffer(
        imageBuffer,
        imageBuffer.length,
        'png',
      ),
    ).rejects.toBeInstanceOf(ImageResizeError)
  })

  test('catch block: large (overDim) but <=5MB image is allowed through, not thrown', async () => {
    mock.module(imageProcessorPath, () => ({
      ...actualImageProcessor,
      // getImageProcessor resolves, but sharp construction crashes (simulates
      // the native connector failing on Windows) -> function lands in catch.
      getImageProcessor: () => Promise.resolve(() => {
        throw new Error('image_processor_napi crashed')
      }),
    }))
    const { maybeResizeAndDownsampleImageBuffer } = await loadResizerModule()

    // 1920x1080 PNG, small byte size -> base64 well under 5MB.
    const imageBuffer = makePngBuffer(1920, 1080)

    const result = await maybeResizeAndDownsampleImageBuffer(
      imageBuffer,
      imageBuffer.length,
      'png',
    )

    // Regression: previously this threw ImageResizeError because overDim was
    // required to be false. Now it passes through because the API resizes
    // large dimensions server-side.
    expect(result.buffer).toBeInstanceOf(Buffer)
    expect(result.mediaType).toBe('png')
  })

  test('catch block: image over 5MB base64 still throws ImageResizeError', async () => {
    mock.module(imageProcessorPath, () => ({
      ...actualImageProcessor,
      getImageProcessor: () => Promise.resolve(() => {
        throw new Error('image_processor_napi crashed')
      }),
    }))
    const { maybeResizeAndDownsampleImageBuffer, ImageResizeError } =
      await loadResizerModule()

    // A large buffer: base64 size = ceil(len*4/3) must exceed 5MB.
    const imageBuffer = Buffer.concat([
      makePngBuffer(1920, 1080),
      randomBytes(5 * 1024 * 1024), // ~5MB raw -> >5MB base64
    ])

    await expect(
      maybeResizeAndDownsampleImageBuffer(
        imageBuffer,
        imageBuffer.length,
        'png',
      ),
    ).rejects.toBeInstanceOf(ImageResizeError)
  })

  test('catch block: image over 2000px many-image limit is rejected when downsample unavailable', async () => {
    mock.module(imageProcessorPath, () => ({
      ...actualImageProcessor,
      getImageProcessor: () => Promise.resolve(() => {
        throw new Error('image_processor_napi crashed')
      }),
    }))
    const { maybeResizeAndDownsampleImageBuffer, ImageResizeError } =
      await loadResizerModule()

    // 3840x2160 PNG, small byte size -> base64 well under 5MB, but the
    // 2000px many-image dimension limit is exceeded.
    const imageBuffer = makePngBuffer(3840, 2160)

    await expect(
      maybeResizeAndDownsampleImageBuffer(
        imageBuffer,
        imageBuffer.length,
        'png',
      ),
    ).rejects.toBeInstanceOf(ImageResizeError)
  })

  test('catch block: image over 2000px is downsampled via Canvas fallback when available', async () => {
    mock.module(imageProcessorPath, () => ({
      ...actualImageProcessor,
      getImageProcessor: () => Promise.resolve(() => {
        throw new Error('image_processor_napi crashed')
      }),
    }))
    const { maybeResizeAndDownsampleImageBuffer } = await loadResizerModule()

    // Fake Canvas so tryDownsampleToManyImageLimit succeeds. Mirror the
    // browser/Electron shape the production code resolves first: a `document`
    // object exposing createElement/Image, with Image firing onload.
    const downsampledBytes = Buffer.from('downsampled-pixels')
    const dataUrl = `data:image/png;base64,${downsampledBytes.toString('base64')}`
    const savedDocument = (globalThis as any).document
    ;(globalThis as any).document = {
      createElement: (_tag: string) => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() {} }),
        toDataURL: () => dataUrl,
      }),
      Image: class {
        onload: (() => void) | null = null
        onerror: ((e: unknown) => void) | null = null
        // Fires onload from the `src` setter (not the constructor) so this
        // test verifies handlers are installed before `src` is assigned —
        // matching a real DOM Image, whose constructor takes no URL argument.
        set src(_v: string) {
          queueMicrotask(() => this.onload?.())
        }
      },
    }

    const imageBuffer = makePngBuffer(3840, 2160)
    try {
      const result = await maybeResizeAndDownsampleImageBuffer(
        imageBuffer,
        imageBuffer.length,
        'png',
      )
      expect(result.buffer).toBeInstanceOf(Buffer)
      expect(result.buffer.equals(imageBuffer)).toBe(false)
      expect(result.buffer.equals(downsampledBytes)).toBe(true)
    } finally {
      ;(globalThis as any).document = savedDocument
    }
  })

  test('catch block: oversized non-PNG (WEBP/JPEG/GIF) is still rejected when downsample unavailable', async () => {
    mock.module(imageProcessorPath, () => ({
      ...actualImageProcessor,
      getImageProcessor: () => Promise.resolve(() => {
        throw new Error('image_processor_napi crashed')
      }),
    }))
    const { maybeResizeAndDownsampleImageBuffer, ImageResizeError } =
      await loadResizerModule()

    // Each fixture exceeds 2000px and is base64-small, so the guard must fire
    // even for these formats (regression for the JPEG/GIF/WebP false-negative).
    const fixtures: Array<[Buffer, string]> = [
      [makeJpegBuffer(3840, 2160), 'jpeg'],
      [makeWebpLossyBuffer(3800, 2100), 'webp'],
      [makeGifBuffer(3000, 2500), 'gif'],
    ]
    for (const [imageBuffer, ext] of fixtures) {
      await expect(
        maybeResizeAndDownsampleImageBuffer(
          imageBuffer,
          imageBuffer.length,
          ext,
        ),
      ).rejects.toBeInstanceOf(ImageResizeError)
    }
  })

  test('readImageDimensions: parses real WebP VP8/VP8L byte offsets', async () => {
    const { readImageDimensions } = await loadResizerModule()
    // Oversized lossy + lossless are rejected by the many-image guard...
    expect(readImageDimensions(makeWebpLossyBuffer(3800, 2100))).toEqual({
      width: 3800,
      height: 2100,
    })
    expect(readImageDimensions(makeWebpLosslessBuffer(2500, 1800))).toEqual({
      width: 2500,
      height: 1800,
    })
    // ...and an in-limit WebP is accepted (parsed exactly).
    expect(readImageDimensions(makeWebpLossyBuffer(1500, 1200))).toEqual({
      width: 1500,
      height: 1200,
    })
  })

  test('readImageDimensions: VP8 lossy at exactly the 2000px boundary parses exact dimensions', async () => {
    const { readImageDimensions } = await loadResizerModule()
    expect(readImageDimensions(makeWebpLossyBuffer(2000, 2000))).toEqual({
      width: 2000,
      height: 2000,
    })
  })

  test('catch block: VP8 lossy at exactly the 2000px boundary is allowed through unchanged', async () => {
    mock.module(imageProcessorPath, () => ({
      ...actualImageProcessor,
      getImageProcessor: () => Promise.resolve(() => {
        throw new Error('image_processor_napi crashed')
      }),
    }))
    const { maybeResizeAndDownsampleImageBuffer } = await loadResizerModule()
    const imageBuffer = makeWebpLossyBuffer(2000, 2000)
    const result = await maybeResizeAndDownsampleImageBuffer(
      imageBuffer,
      imageBuffer.length,
      'webp',
    )
    expect(result.buffer.equals(imageBuffer)).toBe(true)
  })

  test('readImageDimensions: parses VP8X extended WebP dimensions exactly', async () => {
    const { readImageDimensions } = await loadResizerModule()
    expect(readImageDimensions(makeWebpExtendedBuffer(1500, 1200))).toEqual({
      width: 1500,
      height: 1200,
    })
  })

  test('catch block: in-limit VP8X extended WebP is allowed through unchanged', async () => {
    mock.module(imageProcessorPath, () => ({
      ...actualImageProcessor,
      getImageProcessor: () => Promise.resolve(() => {
        throw new Error('image_processor_napi crashed')
      }),
    }))
    const { maybeResizeAndDownsampleImageBuffer } = await loadResizerModule()
    const imageBuffer = makeWebpExtendedBuffer(1500, 1200)
    const result = await maybeResizeAndDownsampleImageBuffer(
      imageBuffer,
      imageBuffer.length,
      'webp',
    )
    expect(result.buffer.equals(imageBuffer)).toBe(true)
  })

  test('catch block: oversized VP8X extended WebP is rejected when downsample unavailable', async () => {
    mock.module(imageProcessorPath, () => ({
      ...actualImageProcessor,
      getImageProcessor: () => Promise.resolve(() => {
        throw new Error('image_processor_napi crashed')
      }),
    }))
    const { maybeResizeAndDownsampleImageBuffer, ImageResizeError } =
      await loadResizerModule()
    const imageBuffer = makeWebpExtendedBuffer(3840, 2160)
    await expect(
      maybeResizeAndDownsampleImageBuffer(
        imageBuffer,
        imageBuffer.length,
        'webp',
      ),
    ).rejects.toBeInstanceOf(ImageResizeError)
  })

  test('catch block: in-limit WEBP (<=2000px) is allowed through unchanged', async () => {
    mock.module(imageProcessorPath, () => ({
      ...actualImageProcessor,
      getImageProcessor: () => Promise.resolve(() => {
        throw new Error('image_processor_napi crashed')
      }),
    }))
    const { maybeResizeAndDownsampleImageBuffer } = await loadResizerModule()
    // 1500x1200 WebP, small byte size -> base64 well under 5MB.
    const imageBuffer = makeWebpLossyBuffer(1500, 1200)
    const result = await maybeResizeAndDownsampleImageBuffer(
      imageBuffer,
      imageBuffer.length,
      'webp',
    )
    expect(result.buffer).toBeInstanceOf(Buffer)
    expect(result.buffer.equals(imageBuffer)).toBe(true)
  })

  test('happy path: small in-limit PNG returns dimensions', async () => {
    mock.module(imageProcessorPath, () => ({
      ...actualImageProcessor,
      getImageProcessor: () => Promise.resolve(sharpFactory),
    }))
    const { maybeResizeAndDownsampleImageBuffer } = await loadResizerModule()

    mockMetadata = { width: 100, height: 50, format: 'png' }
    const imageBuffer = makePngBuffer(100, 50)

    const result = await maybeResizeAndDownsampleImageBuffer(
      imageBuffer,
      imageBuffer.length,
      'png',
    )

    expect(result.mediaType).toBe('png')
    expect(result.dimensions).toEqual({
      originalWidth: 100,
      originalHeight: 50,
      displayWidth: 100,
      displayHeight: 50,
    })
  })
})
