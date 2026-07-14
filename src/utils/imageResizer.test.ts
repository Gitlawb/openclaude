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
