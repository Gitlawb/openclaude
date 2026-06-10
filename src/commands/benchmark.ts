import type { ToolUseContext } from '../Tool.js'
import type { CommandBase } from '../types/command.js'
import {
  benchmarkModel,
  benchmarkMultipleModels,
  formatBenchmarkResults,
  isBenchmarkSupported,
} from '../utils/model/benchmark.js'
import { getCachedOllamaModelOptions } from '../utils/model/ollamaModels.js'

/**
 * ToolUseContext doesn't carry stdout/args; this (currently unregistered)
 * command was written against an extended context that provides them.
 */
type BenchmarkContext = ToolUseContext & {
  stdout?: { write: (chunk: string) => void }
  args?: Record<string, unknown>
}

async function runBenchmark(
  model?: string,
  context?: BenchmarkContext,
): Promise<void> {
  if (!isBenchmarkSupported()) {
    context?.stdout?.write(
      'Benchmark not supported for this provider.\n' +
        'Supported: OpenAI-compatible endpoints (Ollama, NVIDIA NIM)\n',
    )
    return
  }

  let modelsToBenchmark: string[]

  if (model) {
    modelsToBenchmark = [model]
  } else {
    const ollamaModels = getCachedOllamaModelOptions()
    // ModelOption.value is ModelSetting (ModelName | ModelAlias | null);
    // only concrete model names can be benchmarked.
    modelsToBenchmark = ollamaModels
      .slice(0, 3)
      .map((m) => m.value)
      .filter((v): v is string => typeof v === 'string')
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

// Not a full `Command` (no type discriminant/description) — this command is
// not registered anywhere yet; typed structurally to match what it actually is.
export const benchmark: Pick<CommandBase, 'name'> & {
  onExecute(context: BenchmarkContext): Promise<void>
} = {
  name: 'benchmark',

  async onExecute(context: BenchmarkContext): Promise<void> {
    const args = context.args ?? {}
    const model = args.model as string | undefined

    await runBenchmark(model, context)
  },
}
