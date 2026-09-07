import { afterEach, expect, test } from 'bun:test'
import { executeUserInput, handlePromptSubmit } from './handlePromptSubmit.js'
import { enqueue, getCommandQueue, resetCommandQueue } from './messageQueueManager.js'
import { QueryGuard } from './QueryGuard.js'
import { createUserMessage } from './messages.js'

function fixture(guard: QueryGuard) {
  const controllers: Array<AbortController | null> = []
  let queries = 0
  const params: Parameters<typeof executeUserInput>[0] = {
    messages: [], mainLoopModel: 'test', querySource: 'repl_main_thread',
    queryGuard: guard, commands: [], ideSelection: undefined,
    queuedCommands: [{ value: 'first', mode: 'prompt' }, { value: 'second', mode: 'prompt' }],
    setToolJSX: () => {}, getToolUseContext: (_m, _n, abortController) => ({ abortController }) as never,
    setUserInputOnProcessing: () => {}, setAbortController: c => controllers.push(c),
    onQuery: async () => { queries++ }, setAppState: () => {}, resetHistory: () => {},
    canUseTool: (async () => ({ behavior: 'allow' })) as never, onInputChange: () => {},
  }
  return { params, controllers, queries: () => queries }
}

afterEach(resetCommandQueue)

test('cancel during preparation preserves unstarted messages and cannot clean up a newer dispatch', async () => {
  const guard = new QueryGuard()
  const old = fixture(guard)
  let completeOld!: (v: never) => void
  const oldResult = new Promise<never>(resolve => { completeOld = resolve })
  const oldRun = executeUserInput(old.params, () => oldResult)
  const firstController = old.controllers[0]!
  enqueue({ value: 'third', mode: 'prompt' })
  guard.pause()
  firstController.abort('user-cancel')
  guard.resume()
  const current = fixture(guard)
  current.params.queuedCommands = [{ value: 'new turn', mode: 'prompt' }]
  let completeNew!: (v: never) => void
  const newResult = new Promise<never>(resolve => { completeNew = resolve })
  const newRun = executeUserInput(current.params, () => newResult)
  completeOld({ messages: [createUserMessage({ content: 'obsolete' })], shouldQuery: true } as never)
  await oldRun
  expect(old.queries()).toBe(0)
  expect(old.controllers).toEqual([firstController])
  expect(guard.isActive).toBe(true)
  expect(current.controllers[0]?.signal.aborted).toBe(false)
  expect(getCommandQueue().map(c => c.value)).toEqual(['second', 'third'])
  completeNew({ messages: [], shouldQuery: false } as never)
  await newRun
  expect(guard.isActive).toBe(false)
})

test('a submission resumes a paused queue without dropping queued attachments or starting out of order', async () => {
  const guard = new QueryGuard()
  guard.pause()
  const pending = { value: 'queued', mode: 'prompt' as const,
    pastedContents: { 1: { id: 1, type: 'image' as const, content: 'image-data', mediaType: 'image/png' } } }
  enqueue(pending)
  const f = fixture(guard)
  await handlePromptSubmit({ ...f.params, queuedCommands: undefined,
    input: 'continue', mode: 'prompt', onInputChange: () => {}, setPastedContents: () => {},
    helpers: { setCursorOffset: () => {}, clearBuffer: () => {}, resetHistory: () => {} },
  })
  expect(guard.isPaused).toBe(false)
  expect(f.queries()).toBe(0)
  expect(getCommandQueue().map(c => c.value)).toEqual(['queued', 'continue'])
  expect(getCommandQueue()[0]?.pastedContents).toEqual(pending.pastedContents)
})

test('Esc reaches preparation while startup hooks are pending', async () => {
  const guard = new QueryGuard()
  const f = fixture(guard)
  let release!: () => void
  f.params.beforeProcessInput = () => new Promise<void>(resolve => { release = resolve })
  let processed = 0
  const running = executeUserInput(f.params, async () => { processed++; return { messages: [], shouldQuery: false } })
  expect(guard.isActive).toBe(true)
  expect(f.controllers[0]).toBeInstanceOf(AbortController)
  guard.pause()
  f.controllers[0]!.abort('user-cancel')
  expect(getCommandQueue().map(c => c.value)).toEqual(['second'])
  release()
  await running
  expect(processed).toBe(0)
  expect(guard.isPaused).toBe(true)
})
