import { expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { CostTracker } from "./costTracker.js"
import { PriceTable } from "./priceTable.js"

let tempDir: string
let tracker: CostTracker

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "cost-test-"))
  mkdirSync(join(tempDir, ".openclaude"), { recursive: true })
  tracker = new CostTracker(tempDir, new PriceTable())
})

afterEach(() => { rmSync(tempDir, { recursive: true, force: true }) })

test("records a DeepSeek call with correct cost", () => {
  const entry = tracker.recordCall("deepseek-chat", "T1", 10000, 5000, 2000)
  expect(entry.costTotal).toBeCloseTo(0.0049, 4)
})

test("records Ollama call as free", () => {
  const entry = tracker.recordCall("qwen2.5:7b", "T0", 10000, 5000, 1500)
  expect(entry.costTotal).toBe(0)
})

test("getTodaySummary aggregates correctly", () => {
  tracker.recordCall("deepseek-chat", "T1", 1_000_000, 500_000, 2000)
  tracker.recordCall("deepseek-chat", "T1", 500_000, 250_000, 1500)
  const summary = tracker.getTodaySummary()
  expect(summary.total).toBeGreaterThan(0)
  expect(summary.byModel["deepseek-chat"]!.calls).toBe(2)
})

test("tracks task-level costs", () => {
  tracker.recordCall("deepseek-chat", "T1", 100_000, 50_000, 1000, "t1")
  tracker.recordCall("deepseek-chat", "T1", 200_000, 100_000, 1500, "t1")
  tracker.recordCall("deepseek-chat", "T1", 50_000, 25_000, 800, "t2")
  expect(tracker.getTaskCost("t1")).toBeGreaterThan(tracker.getTaskCost("t2"))
})

test("savings calculation works", () => {
  tracker.recordCall("deepseek-chat", "T1", 1_000_000, 1_000_000, 2000)
  const savings = tracker.getSavingsToday()
  expect(savings.actual).toBeCloseTo(0.70, 1)
  expect(savings.opusEquivalent).toBeCloseTo(90.0, 0)
  expect(savings.percentage).toBeGreaterThan(90)
})
