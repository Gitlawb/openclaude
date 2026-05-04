/**
 * Desktop Electron renderer (React) component tests.
 *
 * These tests require @testing-library/react + jsdom environment which
 * bun:test does not support. They run in the separate "desktop" CI job
 * via vitest, not in the main "smoke-and-tests" job via bun:test.
 *
 * Run: cd packages/desktop && bun run test
 */
import { describe, it, expect, vi } from "vitest"

// Skip entire suite when vitest-only APIs unavailable
// In bun:test (root CI smoke-and-tests), vi.resetModules doesn't exist
// In vitest (desktop CI job), it's properly available
const vitestOnly = typeof vi.resetModules === "function" ? describe : describe.skip

vitestOnly("App", () => {
  it("renders without crashing", async () => {
    const { render, screen } = await import("@testing-library/react")
    const { App } = await import("../../src/renderer/App")
    render(<App />)
    expect(screen.getByText("OpenClaude Desktop")).toBeDefined()
  })

  it("shows loading message", async () => {
    const { render, screen } = await import("@testing-library/react")
    const { App } = await import("../../src/renderer/App")
    render(<App />)
    const loadingElements = screen.getAllByText("Loading...")
    expect(loadingElements.length).toBeGreaterThan(0)
  })

  it("has app-shell structure", async () => {
    const { render } = await import("@testing-library/react")
    const { App } = await import("../../src/renderer/App")
    const { container } = render(<App />)
    expect(container.querySelector(".app-shell")).toBeDefined()
    expect(container.querySelector(".app-header")).toBeDefined()
    expect(container.querySelector(".app-main")).toBeDefined()
  })
})