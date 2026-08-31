import { afterEach, beforeAll, beforeEach, expect, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { CONTEXT_1M_BETA_HEADER } from '../constants/betas.js'

// Claude 5 and Opus 4.8 ship 1M context unconditionally on first-party routes,
// but the unconditional default must not outrank a limit the active route
// actually reports. A gateway can serve a Claude 5-named model with a smaller
// window — the Concentrate catalog maps `claude-sonnet-5` to a 200,000-token
// `max_input_tokens` — and budgeting that route as 1M keeps auto-compaction
// idle while the session grows until the endpoint rejects the request.
//
// The outbound 1M beta header is derived from the same decision, so a capped
// route must not advertise the beta either.

const ROUTE_ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CONCENTRATE_API_KEY',
  'CONCENTRATE_BASE_URL',
  'CONCENTRATE_MODEL',
  'CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS',
  'CLAUDE_CODE_DISABLE_1M_CONTEXT',
  'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
  'USER_TYPE',
] as const

function clearRouteEnv(): void {
  for (const key of ROUTE_ENV_KEYS) {
    delete process.env[key]
  }
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/context.claude5RouteLimits.test.ts')
  clearRouteEnv()
})

afterEach(() => {
  try {
    clearRouteEnv()
  } finally {
    releaseSharedMutationLock()
  }
})

// getContextWindowForModel reads the route live from process.env and
// getAllModelBetas memoizes per model, so each test needs its own module
// instance.
async function importFresh() {
  const salt = `${Date.now()}-${Math.random()}`
  const [context, betas] = await Promise.all([
    import(`./context.js?ts=${salt}`),
    import(`./betas.js?ts=${salt}`),
  ])
  return { ...context, getAllModelBetas: betas.getAllModelBetas }
}

beforeAll(async () => {
  await importFresh()
})

test('a route-reported window caps the unconditional 1M default', async () => {
  process.env.CONCENTRATE_API_KEY = 'concentrate-key'
  process.env.CONCENTRATE_MODEL = 'claude-sonnet-5'
  process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS = JSON.stringify({
    'claude-sonnet-5': 200_000,
  })

  const { getContextWindowForModel, modelResolvesTo1MContext, getAllModelBetas } =
    await importFresh()

  expect(getContextWindowForModel('claude-sonnet-5')).toBe(200_000)
  expect(modelResolvesTo1MContext('claude-sonnet-5')).toBe(false)
  expect(getAllModelBetas('claude-sonnet-5')).not.toContain(
    CONTEXT_1M_BETA_HEADER,
  )
})

test('a route that reports no window keeps the unconditional 1M default', async () => {
  process.env.CONCENTRATE_API_KEY = 'concentrate-key'
  process.env.CONCENTRATE_MODEL = 'claude-opus-5'

  const { getContextWindowForModel, modelResolvesTo1MContext, getAllModelBetas } =
    await importFresh()

  expect(getContextWindowForModel('claude-opus-5')).toBe(1_000_000)
  expect(modelResolvesTo1MContext('claude-opus-5')).toBe(true)
  expect(getAllModelBetas('claude-opus-5')).toContain(CONTEXT_1M_BETA_HEADER)
})

test('switching to a capped route refreshes the cached 1M beta decision', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  const { getAllModelBetas } = await importFresh()

  expect(getAllModelBetas('claude-sonnet-5')).toContain(CONTEXT_1M_BETA_HEADER)

  process.env.CONCENTRATE_API_KEY = 'concentrate-key'
  process.env.CONCENTRATE_MODEL = 'claude-sonnet-5'
  process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS = JSON.stringify({
    'claude-sonnet-5': 200_000,
  })

  expect(getAllModelBetas('claude-sonnet-5')).not.toContain(
    CONTEXT_1M_BETA_HEADER,
  )
})

// CLAUDE_CODE_MAX_CONTEXT_TOKENS caps local budgeting while still talking to a
// 1M-capable endpoint, so it must not strip the outbound 1M beta header.
test('a local context cap does not drop the 1M beta header', async () => {
  process.env.USER_TYPE = 'ant'
  process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = '200000'

  const { getContextWindowForModel, modelResolvesTo1MContext, getAllModelBetas } =
    await importFresh()

  expect(getContextWindowForModel('claude-opus-5')).toBe(200_000)
  expect(modelResolvesTo1MContext('claude-opus-5')).toBe(true)
  expect(getAllModelBetas('claude-opus-5')).toContain(CONTEXT_1M_BETA_HEADER)
})

test('an explicit runtime limit outranks the unconditional 1M default', async () => {
  const { getContextWindowForModel } = await importFresh()

  // Callers that already hold discovered metadata pass it in directly.
  expect(
    getContextWindowForModel('claude-opus-5', undefined, {
      contextWindow: 200_000,
    }),
  ).toBe(200_000)
  expect(
    getContextWindowForModel('claude-sonnet-5', undefined, {
      contextWindow: 200_000,
    }),
  ).toBe(200_000)
  expect(getContextWindowForModel('claude-opus-5')).toBe(1_000_000)
})

test('a route-reported window caps the [1m] suffix too', async () => {
  process.env.CONCENTRATE_API_KEY = 'concentrate-key'
  process.env.CONCENTRATE_MODEL = 'claude-sonnet-5'
  process.env.CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS = JSON.stringify({
    'claude-sonnet-5': 200_000,
  })

  const { getContextWindowForModel, modelResolvesTo1MContext, getAllModelBetas } =
    await importFresh()

  expect(getContextWindowForModel('claude-sonnet-5[1m]')).toBe(200_000)
  expect(
    getContextWindowForModel('claude-sonnet-5[1m]', undefined, {
      contextWindow: 200_000,
    }),
  ).toBe(200_000)
  expect(modelResolvesTo1MContext('claude-sonnet-5[1m]')).toBe(false)
  expect(getAllModelBetas('claude-sonnet-5[1m]')).not.toContain(
    CONTEXT_1M_BETA_HEADER,
  )
})

test('the [1m] suffix still budgets 1M when the route reports no window', async () => {
  process.env.CONCENTRATE_API_KEY = 'concentrate-key'
  process.env.CONCENTRATE_MODEL = 'claude-opus-5'

  const { getContextWindowForModel, modelResolvesTo1MContext, getAllModelBetas } =
    await importFresh()

  expect(getContextWindowForModel('claude-opus-5[1m]')).toBe(1_000_000)
  expect(modelResolvesTo1MContext('claude-opus-5[1m]')).toBe(true)
  expect(getAllModelBetas('claude-opus-5[1m]')).toContain(CONTEXT_1M_BETA_HEADER)
})
