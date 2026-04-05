import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import { join } from "node:path"
import type { CostEntry, Tier } from "./types.js"
import { PriceTable } from "./priceTable.js"
import type { EventLog } from "./eventLog.js"

interface DaySummary {
  total: number
  byModel: Record<string, { calls: number; tokensIn: number; tokensOut: number; cost: number }>
  byTask: Record<string, number>
  opusEquivalent: number
}

interface CostLedger {
  daily: Record<string, DaySummary>
  monthly: Record<string, { total: number; opusEquivalent: number }>
  alltime: { total: number; opusEquivalent: number }
}

export class CostTracker {
  private ledgerPath: string
  private ledger: CostLedger
  private priceTable: PriceTable
  private eventLog: EventLog | null = null
  private budgetDaily: number
  private budgetMonthly: number
  private taskCosts: Map<string, number> = new Map()

  constructor(projectDir: string, priceTable: PriceTable, budgetDaily: number = 5, budgetMonthly: number = 50) {
    this.ledgerPath = join(projectDir, ".openclaude", "cost-ledger.json")
    this.priceTable = priceTable
    this.budgetDaily = budgetDaily
    this.budgetMonthly = budgetMonthly
    this.ledger = this.loadLedger()
  }

  setEventLog(eventLog: EventLog): void { this.eventLog = eventLog }

  recordCall(model: string, tier: Tier, tokensIn: number, tokensOut: number, latencyMs: number, taskId: string | null = null, cacheHit: boolean = false): CostEntry {
    const { costIn, costOut, costTotal } = this.priceTable.calculateCost(model, tokensIn, tokensOut)
    const opusCost = this.priceTable.calculateOpusCost(tokensIn, tokensOut)
    const entry: CostEntry = { tier, model, tokensIn, tokensOut, costIn, costOut, costTotal, latencyMs, taskId, cacheHit }

    const today = new Date().toISOString().slice(0, 10)
    const month = today.slice(0, 7)

    if (!this.ledger.daily[today]) { this.ledger.daily[today] = { total: 0, byModel: {}, byTask: {}, opusEquivalent: 0 } }
    const day = this.ledger.daily[today]!
    day.total += costTotal
    day.opusEquivalent += opusCost

    if (!day.byModel[model]) { day.byModel[model] = { calls: 0, tokensIn: 0, tokensOut: 0, cost: 0 } }
    day.byModel[model]!.calls++
    day.byModel[model]!.tokensIn += tokensIn
    day.byModel[model]!.tokensOut += tokensOut
    day.byModel[model]!.cost += costTotal

    if (taskId) {
      day.byTask[taskId] = (day.byTask[taskId] ?? 0) + costTotal
      this.taskCosts.set(taskId, (this.taskCosts.get(taskId) ?? 0) + costTotal)
    }

    if (!this.ledger.monthly[month]) { this.ledger.monthly[month] = { total: 0, opusEquivalent: 0 } }
    this.ledger.monthly[month]!.total += costTotal
    this.ledger.monthly[month]!.opusEquivalent += opusCost
    this.ledger.alltime.total += costTotal
    this.ledger.alltime.opusEquivalent += opusCost

    this.eventLog?.emit({ event: "api_call", tier, model, tokens_in: tokensIn, tokens_out: tokensOut, cost_in: costIn, cost_out: costOut, cost_total: costTotal, latency_ms: latencyMs, task_id: taskId, cache_hit: cacheHit })

    if (day.total >= this.budgetDaily * 0.8 && day.total < this.budgetDaily) {
      this.eventLog?.emit({ event: "budget_warning", level: "80%", spent: day.total, budget: this.budgetDaily })
    } else if (day.total >= this.budgetDaily) {
      this.eventLog?.emit({ event: "budget_exceeded", spent: day.total, budget: this.budgetDaily })
    }

    this.saveLedger()
    return entry
  }

  getTodaySummary(): DaySummary { const today = new Date().toISOString().slice(0, 10); return this.ledger.daily[today] ?? { total: 0, byModel: {}, byTask: {}, opusEquivalent: 0 } }
  getMonthSummary(): { total: number; opusEquivalent: number } { const month = new Date().toISOString().slice(0, 7); return this.ledger.monthly[month] ?? { total: 0, opusEquivalent: 0 } }
  getAllTimeSummary(): { total: number; opusEquivalent: number } { return this.ledger.alltime }
  getTaskCost(taskId: string): number { return this.taskCosts.get(taskId) ?? 0 }

  getSavingsToday(): { actual: number; opusEquivalent: number; saved: number; percentage: number } {
    const today = this.getTodaySummary()
    const saved = today.opusEquivalent - today.total
    const percentage = today.opusEquivalent > 0 ? (saved / today.opusEquivalent) * 100 : 0
    return { actual: today.total, opusEquivalent: today.opusEquivalent, saved, percentage }
  }

  private loadLedger(): CostLedger {
    if (existsSync(this.ledgerPath)) { try { return JSON.parse(readFileSync(this.ledgerPath, "utf-8")) } catch {} }
    return { daily: {}, monthly: {}, alltime: { total: 0, opusEquivalent: 0 } }
  }

  private saveLedger(): void {
    try { const tmp = this.ledgerPath + ".tmp"; writeFileSync(tmp, JSON.stringify(this.ledger, null, 2)); renameSync(tmp, this.ledgerPath) } catch {}
  }
}
