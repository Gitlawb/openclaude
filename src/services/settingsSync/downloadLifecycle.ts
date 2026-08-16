export type SettingsDownloadSource = 'userSettings' | 'localSettings'

export type SettingsDownloadFailureKind =
  | 'fetch_failed'
  | 'prepare_failed'
  | 'apply_failed'

export type SettingsDownloadResult =
  | {
      /** Every requested settings or memory entry was applied. */
      complete: true
      failureKind: null
      /** Settings sources whose bytes committed and may be adopted by a session. */
      settingsSourcesWritten: SettingsDownloadSource[]
    }
  | {
      /** At least one requested entry was not applied. */
      complete: false
      /** Distinguishes a fail-open fetch from a consistency-sensitive apply failure. */
      failureKind: SettingsDownloadFailureKind
      /** Settings sources whose bytes committed despite the incomplete operation. */
      settingsSourcesWritten: SettingsDownloadSource[]
    }

export type SettingsDownloadCoordinator = {
  download(): Promise<SettingsDownloadResult>
  redownload(): Promise<SettingsDownloadResult>
  reset(): void
}

/**
 * Coordinates the cached startup download and explicit redownloads.
 *
 * A redownload supersedes every older generation. The runner receives an
 * `isCurrent` guard that it must check immediately before applying fetched
 * entries. Older waiters then converge on the newest promise instead of
 * observing a synthetic success or applying stale settings.
 */
export function createSettingsDownloadCoordinator(
  defaultMaxRetries: number,
  run: (
    maxRetries: number,
    isCurrent: () => boolean,
    markResultMustMerge: () => void,
  ) => Promise<SettingsDownloadResult>,
  mergeSupersededResults?: (
    superseded: SettingsDownloadResult,
    current: SettingsDownloadResult,
  ) => SettingsDownloadResult,
): SettingsDownloadCoordinator {
  let generation = 0
  let currentPromise: Promise<SettingsDownloadResult> | null = null
  let supersedeCurrent: ((followReplacement: boolean) => void) | null = null

  const start = (maxRetries: number): Promise<SettingsDownloadResult> => {
    const supersedePrevious = supersedeCurrent
    const taskGeneration = ++generation
    let resultMustMerge = false
    let markSuperseded: (followReplacement: boolean) => void
    const superseded = new Promise<boolean>(resolve => {
      markSuperseded = resolve
    })
    supersedeCurrent = markSuperseded!
    const runPromise = run(
      maxRetries,
      () => taskGeneration === generation,
      () => {
        resultMustMerge = true
      },
    )
    // Observe both branches immediately. A superseded runner may reject after
    // the coordination race has moved its waiter to the current generation.
    const settledRunPromise = runPromise.then(
      result => ({ kind: 'result' as const, result }),
      error => ({ kind: 'rejected' as const, error }),
    )
    const coordinatedPromise = (async () => {
      const outcome = await Promise.race([
        settledRunPromise,
        superseded.then(followReplacement => ({
          kind: 'superseded' as const,
          followReplacement,
        })),
      ])
      if (outcome.kind === 'superseded' && !outcome.followReplacement) {
        const resetOutcome = await settledRunPromise
        if (resetOutcome.kind === 'rejected') throw resetOutcome.error
        return resetOutcome.result
      }
      if (outcome.kind === 'superseded' || taskGeneration !== generation) {
        const replacement = currentPromise
        if (replacement !== null && replacement !== coordinatedPromise) {
          const currentResult = await replacement
          if (!mergeSupersededResults || !resultMustMerge) return currentResult
          const supersededOutcome = await settledRunPromise
          if (supersededOutcome.kind === 'rejected') return currentResult
          return mergeSupersededResults(
            supersededOutcome.result,
            currentResult,
          )
        }
        const supersededOutcome = await settledRunPromise
        if (replacement === null || replacement === coordinatedPromise) {
          if (supersededOutcome.kind === 'rejected') {
            throw supersededOutcome.error
          }
          return supersededOutcome.result
        }
        return replacement
      }
      if (outcome.kind === 'rejected') throw outcome.error
      return outcome.result
    })()
    currentPromise = coordinatedPromise
    // Resolve older waiters only after currentPromise points at this generation.
    supersedePrevious?.(true)
    return coordinatedPromise
  }

  return {
    download() {
      return currentPromise ?? start(defaultMaxRetries)
    },
    redownload() {
      return start(0)
    },
    reset() {
      const supersedePrevious = supersedeCurrent
      generation++
      currentPromise = null
      supersedeCurrent = null
      // Detach an in-flight waiter from the cache. With no replacement it
      // still observes its own result/rejection; the next download starts new.
      supersedePrevious?.(false)
    },
  }
}

export type SettingsDownloadDecision = {
  proceed: boolean
  failureKind: SettingsDownloadFailureKind | null
  error: Error | null
}

/**
 * Applies the shared download policy used by startup, SDK reload, and
 * `/reload-plugins`.
 *
 * Committed settings sources are always notified so session state can align
 * with disk. Partial/failed applies block plugin advancement. A total fetch
 * failure may fail open to plugins already present on local disk only when the
 * caller opts into that historical behavior.
 */
export function handleSettingsDownloadResult(
  result: SettingsDownloadResult,
  options: {
    notify(source: SettingsDownloadSource): void
    failOpenOnFetchFailure: boolean
  },
): SettingsDownloadDecision {
  for (const source of result.settingsSourcesWritten) {
    options.notify(source)
  }

  if (result.complete) {
    return { proceed: true, failureKind: null, error: null }
  }

  if (
    result.failureKind === 'fetch_failed' &&
    options.failOpenOnFetchFailure
  ) {
    return { proceed: true, failureKind: result.failureKind, error: null }
  }

  const error = new Error(
    result.failureKind === 'fetch_failed'
      ? 'Remote settings could not be downloaded'
      : result.failureKind === 'prepare_failed'
        ? 'Remote settings could not be prepared for local application'
        : 'Remote settings were only partially applied',
  )
  return { proceed: false, failureKind: result.failureKind, error }
}

/**
 * Shared SDK and slash-command reload contract: network-only fetch failure is
 * fail-open to plugins already on disk; preparation/apply failures fail closed.
 */
export function handleReloadSettingsDownloadResult(
  result: SettingsDownloadResult,
  notify: (source: SettingsDownloadSource) => void,
): SettingsDownloadDecision {
  return handleSettingsDownloadResult(result, {
    notify,
    failOpenOnFetchFailure: true,
  })
}

export type HeadlessPluginPreparationResult =
  | { ready: true }
  | { ready: false; error: Error }

/** Fail the synchronous-install gate before plugin state or the first query advances. */
export function assertHeadlessPluginPreparationReady(
  result: HeadlessPluginPreparationResult,
): asserts result is { ready: true } {
  if (!result.ready) throw result.error
}

/**
 * Owns the cross-path startup sequence: await settings, adopt committed
 * sources, decide whether plugin state may advance, then install and apply MCP.
 */
export async function prepareHeadlessPluginsAfterSettingsDownload(options: {
  downloadSettings(): Promise<SettingsDownloadResult | null>
  waitForManagedSettings(): Promise<unknown>
  notify(source: SettingsDownloadSource): void
  installPlugins(): Promise<boolean>
  applyPluginMcp(): Promise<unknown>
}): Promise<HeadlessPluginPreparationResult> {
  const [settingsResult] = await Promise.all([
    options.downloadSettings(),
    options.waitForManagedSettings(),
  ])

  if (settingsResult) {
    const decision = handleSettingsDownloadResult(settingsResult, {
      notify: options.notify,
      failOpenOnFetchFailure: true,
    })
    if (!decision.proceed) {
      return { ready: false, error: decision.error! }
    }
  }

  const pluginsInstalled = await options.installPlugins()
  if (pluginsInstalled) {
    await options.applyPluginMcp()
  }
  return { ready: true }
}
