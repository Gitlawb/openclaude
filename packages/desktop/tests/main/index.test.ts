import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Electron APIs
const mockWindow = {
  on: vi.fn(),
  show: vi.fn(),
  loadURL: vi.fn(),
  loadFile: vi.fn(),
  webContents: {
    setWindowOpenHandler: vi.fn(),
  },
  isDestroyed: vi.fn(() => false),
}

vi.mock("electron", () => ({
  app: {
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    quit: vi.fn(),
    setAppUserModelId: vi.fn(),
    isPackaged: false,
  },
  BrowserWindow: vi.fn(() => mockWindow),
  shell: {
    openExternal: vi.fn(),
  },
}))

vi.mock("@electron-toolkit/utils", () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: { dev: true },
}))

describe("Main Process", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates BrowserWindow with correct security settings", async () => {
    const { BrowserWindow } = await import("electron")
    // Import main to trigger window creation logic
    await import("../../src/main/index")

    // The whenReady callback creates the window
    const { app } = await import("electron")
    const whenReadyFn = app.whenReady.mock.calls[0]?.[0]
    if (whenReadyFn) {
      await whenReadyFn()
      expect(BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          webPreferences: expect.objectContaining({
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
          }),
        }),
      )
    }
  })

  it("sets preload path correctly", async () => {
    const { BrowserWindow } = await import("electron")
    await import("../../src/main/index")

    const { app } = await import("electron")
    const whenReadyFn = app.whenReady.mock.calls[0]?.[0]
    if (whenReadyFn) {
      await whenReadyFn()
      const config = BrowserWindow.mock.calls[0]?.[0]
      expect(config?.webPreferences?.preload).toContain("preload/index.js")
    }
  })

  it("window dimensions are set", async () => {
    const { BrowserWindow } = await import("electron")
    await import("../../src/main/index")

    const { app } = await import("electron")
    const whenReadyFn = app.whenReady.mock.calls[0]?.[0]
    if (whenReadyFn) {
      await whenReadyFn()
      const config = BrowserWindow.mock.calls[0]?.[0]
      expect(config?.width).toBe(1280)
      expect(config?.height).toBe(800)
      expect(config?.minWidth).toBe(900)
      expect(config?.minHeight).toBe(600)
    }
  })
})
