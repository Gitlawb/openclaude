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

// WebP lossy (VP8) keyframe matching the parser: start code 0x9D 0x01 0x2A at
// bytes 16-18, width-1 at bytes 19-20 (14-bit), height-1 at bytes 21-22.
function makeWebpLossyBuffer(width = 3800, height = 2100): Buffer {
  const buf = Buffer.alloc(32)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(24, 4)
  buf.write('WEBP', 8, 'ascii')
  buf.write('VP8 ', 12, 'ascii')
  buf.writeUInt32LE(16, 16) // chunk size
  buf[16] = 0x9d
  buf[17] = 0x01
  buf[18] = 0x2a
  buf.writeUInt16LE((width - 1) & 0x3fff, 19)
  buf.writeUInt16LE((height - 1) & 0x3fff, 21)
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

    // Fake Canvas so tryDownsampleToManyImageLimit succeeds.
    const downsampledBytes = Buffer.from('downsampled-pixels')
    const dataUrl = `data:image/png;base64,${downsampledBytes.toString('base64')}`
    const savedCreateElement = (globalThis as any).createElement
    const savedImage = (globalThis as any).Image
    ;(globalThis as any).createElement = (_tag: string) => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => dataUrl,
    })
    ;(globalThis as any).Image = class {
      src: string
      onload: (() => void) | null = null
      constructor(src: string) {
        this.src = src
        // Simulate async decode completion on the next tick.
        queueMicrotask(() => this.onload?.())
      }
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
      ;(globalThis as any).createElement = savedCreateElement
      ;(globalThis as any).Image = savedImage
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
