import { describe, it, expect, vi } from "vitest"

// Mock Electron contextBridge
const exposed: Record<string, unknown> = {}

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      exposed[key] = value
    },
  },
}))

describe("Preload", () => {
  it("exposes platform info", async () => {
    await import("../../src/preload/index")
    expect(exposed.platform).toBeDefined()
    expect((exposed.platform as { os: string }).os).toBe(process.platform)
    expect((exposed.platform as { arch: string }).arch).toBe(process.arch)
  })

  it("does not expose Node.js APIs directly", async () => {
    await import("../../src/preload/index")
    // Should only have "platform" exposed, no fs, path, etc.
    const keys = Object.keys(exposed)
    expect(keys).toEqual(["platform"])
    expect(keys).not.toContain("fs")
    expect(keys).not.toContain("path")
    expect(keys).not.toContain("process")
  })
})
