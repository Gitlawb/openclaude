import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { App } from "../../src/renderer/App"

describe("App", () => {
  it("renders without crashing", () => {
    render(<App />)
    expect(screen.getByText("OpenClaude Desktop")).toBeDefined()
  })

  it("shows loading message", () => {
    render(<App />)
    // Use getAllByText since React 19 may render multiple copies
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
