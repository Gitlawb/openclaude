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
