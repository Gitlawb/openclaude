import type { ToolUseContext } from '../Tool.js'
import type { Command } from '../types/command.js'
import {
  benchmarkModel,
  benchmarkMultipleModels,
  formatBenchmarkResults,
  isBenchmarkSupported,
} from '../utils/model/benchmark.js'
import { getCachedOllamaModelOptions as getOllamaModelOptions } from '../utils/model/ollamaModels.js'

async function runBenchmark(
  model?: string,
  context?: ToolUseContext,
): Promise<void> {
  if (!isBenchmarkSupported()) {
    context?.stdout?.write(
      'Benchmark not supported for this provider.\n' +
        'Supported: OpenAI-compatible endpoints (Ollama, NVIDIA NIM, MiniMax)\n',
    )
    return
  }

  let modelsToBenchmark: string[]

  if (model) {
    modelsToBenchmark = [model]
  } else {
    const ollamaModels = getOllamaModelOptions()
    modelsToBenchmark = ollamaModels.slice(0, 3).map((m) => m.value as string)
  }

  context?.stdout?.write(`Benchmarking ${modelsToBenchmark.length} model(s)...\n`)

  const results = await benchmarkMultipleModels(
    modelsToBenchmark,
    (completed, total, result) => {
      context?.stdout?.write(
        `[${completed}/${total}] ${result.model}: ` +
          `${result.success ? result.tokensPerSecond.toFixed(1) + ' tps' : 'FAILED'}\n`,
      )
    },
  )

  context?.stdout?.write('\n' + formatBenchmarkResults(results) + '\n')
}

export const benchmark = {
  name: 'benchmark',

  async onExecute(context: ToolUseContext): Promise<void> {
    const args = context.args ?? {}
    const model = args.model as string | undefined

    await runBenchmark(model, context)
  },
} as unknown as Command