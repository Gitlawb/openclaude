// These tests require @testing-library/react + jsdom environment
// which is only available when running via vitest from packages/desktop/.
// Run with: cd packages/desktop && bun run test
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { App } from "../../src/renderer/App"

// Skip when DOM environment (jsdom) is not available — e.g. root bun test
const domGuard = typeof document !== "undefined" ? describe : describe.skip

domGuard("App", () => {
  it("renders without crashing", () => {
    render(<App />)
    expect(screen.getByText("OpenClaude Desktop")).toBeDefined()
  })

  it("shows loading message", () => {
    render(<App />)
    const loadingElements = screen.getAllByText("Loading...")
    expect(loadingElements.length).toBeGreaterThan(0)
  })

  it("has app-shell structure", () => {
    const { container } = render(<App />)
    expect(container.querySelector(".app-shell")).toBeDefined()
    expect(container.querySelector(".app-header")).toBeDefined()
    expect(container.querySelector(".app-main")).toBeDefined()
  })
})
