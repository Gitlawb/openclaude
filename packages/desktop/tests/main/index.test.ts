/**
 * Desktop Electron main process tests.
 *
 * These tests use vitest-specific APIs (vi.resetModules, vi.doMock) that
 * bun:test does not support. They run in the separate "desktop" CI job
 * via vitest, not in the main "smoke-and-tests" job via bun:test.
 *
 * Run: cd packages/desktop && bun run test
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// Skip when vi.resetModules is unavailable (bun:test runner)
// This allows graceful skip in smoke-and-tests CI job while
// full tests run in dedicated desktop CI job via vitest.
const vitestOnly = typeof vi.resetModules === "function" ? describe : describe.skip

vitestOnly("Main Process", () => {
  let BrowserWindow: ReturnType<typeof vi.fn>
  let mockWindow: Record<string, unknown>
  let mockApp: {
    whenReady: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    quit: ReturnType<typeof vi.fn>
    setAppUserModelId: ReturnType<typeof vi.fn>
    isPackaged: boolean
  }

  beforeEach(() => {
    vi.resetModules()

    mockWindow = {
      on: vi.fn(),
      show: vi.fn(),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      webContents: { setWindowOpenHandler: vi.fn() },
      isDestroyed: vi.fn(() => false),
    }

    mockApp = {
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      quit: vi.fn(),
      setAppUserModelId: vi.fn(),
      isPackaged: false,
    }

    vi.doMock("electron", () => ({
      app: mockApp,
      BrowserWindow: vi.fn(() => mockWindow),
      shell: { openExternal: vi.fn() },
      session: {
        defaultSession: {
          webRequest: { onHeadersReceived: vi.fn() },
        },
      },
    }))

    vi.doMock("@electron-toolkit/utils", () => ({
      electronApp: { setAppUserModelId: vi.fn() },
      optimizer: { watchWindowShortcuts: vi.fn() },
      is: { dev: true },
    }))
  })

  async function loadMain() {
    await import("../../src/main/index")
    await new Promise((r) => setTimeout(r, 0))
    const electron = await import("electron")
    return electron.BrowserWindow
  }

  it("creates BrowserWindow with correct security settings", async () => {
    BrowserWindow = await loadMain()

    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        }),
      }),
    )
  })

  it("sets preload path to built .cjs file", async () => {
    BrowserWindow = await loadMain()

    const config = BrowserWindow.mock.calls[0]?.[0]
    expect(config?.webPreferences?.preload).toMatch(/preload[/\\]index\.cjs/)
  })

  it("window dimensions are set", async () => {
    BrowserWindow = await loadMain()

    const config = BrowserWindow.mock.calls[0]?.[0]
    expect(config?.width).toBe(1280)
    expect(config?.height).toBe(800)
    expect(config?.minWidth).toBe(900)
    expect(config?.minHeight).toBe(600)
  })

  it("registers optimizer.watchWindowShortcuts on browser-window-created", async () => {
    await loadMain()

    const calls = mockApp.on.mock.calls
    const bwCreatedCall = calls.find((c: unknown[]) => c[0] === "browser-window-created")
    expect(bwCreatedCall).toBeDefined()

    const { optimizer } = await import("@electron-toolkit/utils")
    const handler = bwCreatedCall![1] as (event: unknown, win: unknown) => void
    handler({}, mockWindow)
    expect(optimizer.watchWindowShortcuts).toHaveBeenCalledWith(mockWindow)
  })

  it("quits on window-all-closed when not macOS", async () => {
    await loadMain()

    const calls = mockApp.on.mock.calls
    const wacCall = calls.find((c: unknown[]) => c[0] === "window-all-closed")
    expect(wacCall).toBeDefined()

    const handler = wacCall![1] as () => void
    handler()
    expect(mockApp.quit).toHaveBeenCalled()
  })

  it("does not quit on window-all-closed when macOS", async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, "platform", { value: "darwin" })

    await loadMain()

    const calls = mockApp.on.mock.calls
    const wacCall = calls.find((c: unknown[]) => c[0] === "window-all-closed")
    expect(wacCall).toBeDefined()

    const handler = wacCall![1] as () => void
    handler()
    expect(mockApp.quit).not.toHaveBeenCalled()

    Object.defineProperty(process, "platform", { value: originalPlatform })
  })
})