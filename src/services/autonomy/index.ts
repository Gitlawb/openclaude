export {
  classifyComplexity,
  type ComplexityResult,
  type TaskTier,
} from './complexityClassifier.js'
export {
  extractTaskSignals,
  type ExtractTaskSignalsInput,
  type TaskSignals,
} from './taskSignals.js'
export {
  isAutonomyEnabled,
  resolveAutonomyMode,
  resolveTaskRoute,
  type AutonomyMode,
  type ResolveTaskRouteInput,
  type RouteDecision,
} from './routePolicy.js'
export {
  getHealthSnapshot,
  isProviderHealthy,
  pingProvider,
  probeAndUpdate,
  recordFailure,
  recordSuccess,
  resetHealthRegistryForTests,
  scoreProvider,
  type HealthSnapshot,
  type ProviderHealthEntry,
} from './providerHealth.js'
export {
  advanceFallbackOnFailure,
  applyHealthSelection,
  isProviderFailoverError,
  recordProviderFailure,
  recordProviderSuccess,
  type FallbackCapableOverride,
} from './providerFallback.js'
export {
  createCircuitBreakerState,
  defaultCircuitConfig,
  observeToolResult,
  type CircuitBreakerConfig,
  type CircuitBreakerState,
  type CircuitResult,
} from './circuitBreakers.js'
export {
  appendTurnTelemetry,
  getTelemetryPath,
  readRecentTelemetry,
  type TurnTelemetryEvent,
} from './telemetry.js'
export {
  writeSessionInsights,
  listInsightFiles,
  getInsightsDir,
} from './sessionInsights.js'
export {
  resolveAutonomyForMessages,
  extractUserTextFromMessages,
  messagesHaveImage,
} from './resolveForMessages.js'
export {
  circuitBreakersEnabled,
  createToolCircuitSession,
  extractToolObservation,
  observeToolMessage,
} from './circuitToolBridge.js'
