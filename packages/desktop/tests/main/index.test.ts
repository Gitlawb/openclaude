import { describe, it, expect, vi, beforeEach } from "vitest"

describe("Main Process", () => {
  let BrowserWindow: ReturnType<typeof vi.fn>
  let mockWindow: Record<string, unknown>

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

    vi.doMock("electron", () => ({
      app: {
        whenReady: vi.fn(() => Promise.resolve()),
        on: vi.fn(),
        quit: vi.fn(),
        setAppUserModelId: vi.fn(),
        isPackaged: false,
      },
      BrowserWindow: vi.fn(() => mockWindow),
      shell: { openExternal: vi.fn() },
    }))

    vi.doMock("@electron-toolkit/utils", () => ({
      electronApp: { setAppUserModelId: vi.fn() },
      optimizer: { watchWindowShortcuts: vi.fn() },
      is: { dev: true },
    }))
  })

  async function loadMain() {
    await import("../../src/main/index")
    // Flush microtask queue so app.whenReady().then(...) resolves
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
})
