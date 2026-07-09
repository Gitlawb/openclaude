# 2026-07-09 — Phase 2 Health + Fallback

**Contexto:** Continuação do Autonomy Controller após Phase 1 (task tiers).

**Ação:**
- `providerHealth.ts` — EMA latência, error rate, unhealthy após 2 falhas
- `providerFallback.ts` — health-override na seleção + advance em erro live
- `withRetry` — hooks `tryProviderFailover` / `onProviderSuccess`
- `claude.ts` — failover mutável de `providerOverride` no stream e non-stream
- `doctor:autonomy` — snapshot de health e rotas

**Resultado:** 50 testes autonomy-related passando.

**Como diagnosticar:**

```powershell
bun run doctor:autonomy
bun run doctor:autonomy:probe
```

**Política:** configurar `fallbackChains` no settings (ver ROUTING_BASELINE / GUIA_USO).

**Próximo:** Phase 3 — circuit breakers + effort por tier.
