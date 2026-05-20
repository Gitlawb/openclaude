import { logForDebugging } from '../../utils/debug.js'
import { addAgentRunObserver } from './agentRunner.js'
import { AgentApiServer } from './apiServer.js'
import {
  type AgentGatewayConfig,
  isAgentGatewayEnabled,
  loadAgentGatewayConfig,
} from './config.js'
import { startCronScheduler, type CronSchedulerHandle } from './cron.js'
import { TelegramAgentBridge } from './telegram.js'
import {
  createBackgroundConsciousness,
  type ConsciousnessHandle,
} from './consciousness.js'
import { ensureMemoryFiles } from './memory.js'
import { shouldConsolidateDialogue, consolidateDialogue, shouldConsolidateScratchpad, consolidateScratchpad } from './consolidation.js'

export type AgentGatewayRuntime = {
  config: AgentGatewayConfig
  api?: AgentApiServer
  telegram?: TelegramAgentBridge
  cron?: CronSchedulerHandle
  consciousness?: ConsciousnessHandle
  stopAgentRunObserver?: () => void
  startedAt: number
}

let runtime: AgentGatewayRuntime | null = null

export function getAgentGatewayRuntime(): AgentGatewayRuntime | null {
  return runtime
}

export async function startAgentGatewayFromConfig(): Promise<AgentGatewayRuntime | null> {
  if (process.env.OPENCLAUDE_AGENT_GATEWAY_CHILD === '1') {
    return null
  }
  if (runtime) return runtime

  const config = await loadAgentGatewayConfig()
  if (!isAgentGatewayEnabled(config)) {
    return null
  }

  const nextRuntime: AgentGatewayRuntime = {
    config,
    startedAt: Date.now(),
  }

  // Ensure memory files exist (scratchpad, identity, patterns, etc.)
  await ensureMemoryFiles()

  if (config.telegram.enabled && config.telegram.botToken) {
    nextRuntime.telegram = new TelegramAgentBridge(config)
    nextRuntime.telegram.start()
  }

  if (config.api.enabled) {
    nextRuntime.api = new AgentApiServer({
      config,
      onAgentResponse: async text => {
        if (
          config.telegram.enabled &&
          config.telegram.mirrorAgentApiResponses &&
          nextRuntime.telegram
        ) {
          await nextRuntime.telegram.sendHomeMessage(text)
        }
      },
    })
    await nextRuntime.api.start()
  }

  if (config.cron.enabled) {
    nextRuntime.cron = startCronScheduler(config, async (content, job) => {
      if (!nextRuntime.telegram) return
      const target = job.origin?.chatId || config.telegram.homeChatId
      if (!target) return
      await nextRuntime.telegram.sendMessage(
        target,
        `Cronjob Response: ${job.name}\n-----------\n\n${content}`,
      )
    })
  }

  if (config.ouroboros.enabled && config.ouroboros.consciousnessEnabled) {
    let activeAgentRuns = 0
    let consolidationRunning = false
    nextRuntime.consciousness = createBackgroundConsciousness({
      config,
      wakeupMin: config.ouroboros.wakeupMinSeconds,
      wakeupMax: config.ouroboros.wakeupMaxSeconds,
      maxRounds: config.ouroboros.maxRounds,
      budgetFraction: config.ouroboros.budgetFraction,
      onProactiveMessage: async text => {
        const target = config.telegram.homeChatId
        if (target && nextRuntime.telegram) {
          await nextRuntime.telegram.sendMessage(
            target,
            `Ouroboros Report\n-----------\n\n${text}`,
          )
        }
      },
      isTaskRunning: () => activeAgentRuns > 0,
    })

    nextRuntime.stopAgentRunObserver = addAgentRunObserver({
      onStart: context => {
        activeAgentRuns++
        nextRuntime.consciousness?.pause()
        nextRuntime.consciousness?.injectObservation(
          `Task started in ${context.cwd}: ${context.prompt.slice(0, 300)}`,
        )
      },
      onFinish: async (_context, result) => {
        try {
          nextRuntime.consciousness?.injectObservation(
            result.exitCode === 0
              ? `Task completed: ${result.text.slice(0, 300)}`
              : `Task failed: ${result.stderr.slice(0, 300)}`,
          )

          if (!consolidationRunning) {
            consolidationRunning = true
            try {
              if (await shouldConsolidateDialogue()) {
                await consolidateDialogue(config)
              }
              if (await shouldConsolidateScratchpad()) {
                await consolidateScratchpad(config)
              }
            } finally {
              consolidationRunning = false
            }
          }
        } catch {
          // Lifecycle memory is non-critical; agent responses must not fail because of it.
        } finally {
          activeAgentRuns = Math.max(0, activeAgentRuns - 1)
          if (activeAgentRuns === 0) {
            nextRuntime.consciousness?.resume()
          }
        }
      },
    })
  }

  runtime = nextRuntime
  logForDebugging(
    `[agent-gateway] started api=${Boolean(nextRuntime.api)} cron=${Boolean(nextRuntime.cron)} telegram=${Boolean(nextRuntime.telegram)} consciousness=${Boolean(nextRuntime.consciousness)}`,
  )
  return runtime
}

export async function stopAgentGateway(): Promise<void> {
  const current = runtime
  runtime = null
  current?.stopAgentRunObserver?.()
  current?.consciousness?.stop()
  current?.cron?.stop()
  current?.telegram?.stop()
  await current?.api?.stop()
}

export async function restartAgentGateway(): Promise<AgentGatewayRuntime | null> {
  await stopAgentGateway()
  return startAgentGatewayFromConfig()
}
