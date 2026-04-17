---
tags: [bridgeai, vault, schema]
status: active
created: 2026-04-15
updated: 2026-04-15
---

# BridgeAI — Vault Schema (canonical)

> Defines how the vault produced by BridgeAI is structured. Governs all v2 documentation-layer features. Read this before specifying or implementing anything that writes to the vault.

The BridgeAI vault lives **alongside the code repository**, not in a separate location.

---

## 1. General approach

Hybrid of **Zettelkasten + MOC + Karpathy LLM Wiki**:

- Atomic notes of 300–500 words (one concept per file)
- Maps of Content (MOCs) as hierarchical navigation hubs
- `_index.md`, `_conventions.md`, `_log.md` append-only for autonomous maintenance

### Why not PARA, Johnny Decimal, or pure Zettelkasten

- **PARA** — designed for humans prioritizing actions, not for machines. Actionability-based organization is irrelevant for embedding retrieval.
- **Johnny Decimal** — 10×10 cap is too rigid; numeric addresses serve human muscle memory; no inter-note linking.
- **Pure Zettelkasten** — no MOCs/indexes means a graph with no entry point. An LLM scanning thousands of atomic notes without hierarchical navigation loses context.

---

## 2. Folder structure

```
vault/
├── _index.md                    # Master catalog — LLM reads first
├── _conventions.md              # Schema, naming, tag taxonomy
├── _log.md                      # Append-only operation log
├── meta/                        # Templates, validation scripts
│   └── templates/
├── knowledge/                   # Atomic notes (concepts, patterns, modules)
├── maps/                        # MOCs per domain/system
├── decisions/                   # ADRs
├── flows/                       # Flows, pipelines, request lifecycles
├── incidents/                   # Post-mortems, bugs
└── archive/                     # Superseded/deprecated knowledge
```

**Principles:**

1. **Flat inside each folder** — LLM navigates by links and frontmatter, not paths.
2. **Every folder has an `_index.md`** listing its notes.
3. **`meta/` is immutable to the agent in normal operation** — schema changes require human audit.

---

## 3. YAML frontmatter — LLM ↔ vault contract

All fields inside `---` YAML block; never Dataview inline fields. A field has exactly one type across the whole vault.

### Mandatory minimum schema

```yaml
---
title: "API Rate Limiting Patterns"
type: concept               # module | concept | flow | decision | incident | feature | glossary | moc | system | risk
tags:
  - code/api-design
  - pattern/rate-limiting
  - lang/typescript
aliases:
  - rate limiting
status: stable              # draft | active | review | stable | deprecated | archived
created: 2026-04-15
updated: 2026-04-15
confidence: high            # high | medium | low | speculative   (see "Confidence tiers" below)
scope: project              # project | global   (PIFA-01; default: project)
summary: "Token bucket and sliding window rate-limiting strategies."
related:
  - "[[api-gateway-architecture]]"
---
```

### Type-specific additions

- **module:** `source_path`, `language`, `layer`, `domain`, `depends_on`, `depended_by`, `exports`, `last_verified`
- **decision (ADR):** `decision_makers`, `supersedes`, `superseded_by`
- **flow:** `trigger`, `participants`
- **incident:** `severity`, `date_occurred`, `date_resolved`, `duration_minutes`, `root_cause`, `affected_modules`

### Fields exclusive to AI-maintained vaults

- **`confidence`** — LLM prioritizes `high` over `speculative` when assembling context (full tier definitions below)
- **`summary`** — enables scanning dozens of notes without reading the body
- **`last_verified`** — combined with source `mtime`, detects staleness
- **`source: code-analysis` vs `source: llm-inference`** — prevents model collapse on rewrites
- **`scope`** — `project` (default) writes to the local vault; `global` writes to the dev's portable global vault. Modules are always `scope: project` (`type-scope-mismatch` rule rejects `type: module + scope: global`).

### Confidence tiers (PIFA-06, F-2 reconciliation)

Every note's `confidence` field uses one of four values, in order from most to least trustworthy:

- **`high`** — Static-only ground truth: deterministic facts derived from code analysis (exports, imports, dependency edges, file paths, line counts). No LLM involvement at all. The cache-aside layer can serve these without re-checking source.
- **`medium`** — Clean LLM-derived semantic content with successful structured-output validation. Current mapper output for `summary`, `responsibilities`, `domain`, `layer` lands here. The cache-aside threshold is `≥ medium` — these serve from cache when `updated < 30 days`.
- **`low`** — Fallback placeholders (LLM call failed, retried, fell back), escape-hatch deferred content, or output the agent flagged as needing dev confirmation. Cache-aside ALWAYS re-analyzes notes at this tier.
- **`speculative`** — Hypothetical or exploratory content explicitly flagged as untrusted. Reserved for content the dev or agent KNOWS is unverified (e.g. "we *think* this module handles X — needs confirmation"). Treated identically to `low` by the cache layer.

**Cache-aside threshold:** the (separate, downstream) cache-aside query layer reads notes with `confidence ≥ medium` from cache. `low` and `speculative` always re-analyze the source.

**Provenance pairing:** every `_log.md` entry tags the source of the change as `source: code-analysis` (deterministic write) or `source: llm-inference` (LLM-derived write). The pairing of `confidence` + `source` lets future readers tell ground truth from inference at a glance.

---

## 4. Tag taxonomy

Predefined in `_conventions.md`:

```
code/       → code/architecture, code/api-design, code/testing, code/security, code/performance
pattern/    → pattern/creational, pattern/behavioral, pattern/concurrency
lang/       → lang/typescript, lang/python, lang/go, lang/sql
domain/     → domain/auth, domain/payments, domain/search
layer/      → layer/frontend, layer/backend, layer/infra, layer/data
```

Rules: **kebab-case**, **3–7 tags per note**. Tags classify/filter; WikiLinks express semantic relationships. Complementary.

---

## 5. Templates per note type

### Module (file/package/service)

Fixed sections: `TL;DR → Public API → Internal design → Dependencies → Configuration → Error handling`.

Example frontmatter:

```yaml
---
title: "AuthService"
type: module
source_path: "src/services/auth/"
language: typescript
layer: service
domain: auth
depends_on: ["[[user-repository]]", "[[token-manager]]"]
depended_by: ["[[api-gateway]]"]
exports:
  - "AuthService.authenticate()"
  - "AuthService.refreshToken()"
status: active
last_verified: 2026-04-10
confidence: high
summary: "Central auth service: login, token refresh, revocation."
tags: [module, lang/typescript, domain/auth, layer/service]
related: ["[[flow-login-request]]", "[[adr-0012-jwt-authentication]]"]
---
```

### Concept (pattern, domain term, convention)

Sections: `TL;DR → How we use it → Rules and conventions → Trade-offs`.

### Flow (request lifecycle, data flow, pipeline)

Sections: `TL;DR → Numbered sequence → Error paths (table)`. Frontmatter: `trigger`, `participants`.

### MOC

Per-domain hub listing: key modules, flows, decisions, related concepts.

---

## 6. WikiLinks, graph, and naming

Three complementary mechanisms:

- **WikiLinks in body** — inline semantic relationships in context
- **Tags in frontmatter** — dimensional classification/filtering
- **`related:` frontmatter** — explicit graph, parseable by external tools

### Filenames

kebab-case with type prefix:

- `adr-0012-jwt-authentication.md`
- `flow-login-request.md`
- `concept-event-sourcing.md`
- `moc-authentication.md`

### Link density

- Atomic notes: 3–8 outgoing links
- MOCs: 20–50+ links
- **Golden rule:** every note has ≥ 1 incoming link. Zero incoming = orphan invisible to LLM navigation.

---

## 7. LLM-reading optimization

### Note size

- No-RAG (Karpathy-style selective loading): **500–1,500 tokens**
- With RAG (embeddings + splitting): **256–512 tokens per chunk**

Per type:

- Concept/glossary: 200–500 tokens
- Module/pattern: 400–800 tokens
- Flow/ADR: 500–1,000 tokens
- MOCs: variable

### 3-layer "summary at the top" pattern

1. Frontmatter `summary:` — one line, machine-readable
2. Blockquote TL;DR — `> **TL;DR**: ...` right after the H1
3. "Key Points" section — 3–5 takeaways

### Consistent headers per type

Highest-impact optimization: every module note uses the same sections in the same order. LLM jumps straight to the relevant section.

---

## 8. Guardrails and pitfalls

| Problem | Architectural solution |
|---|---|
| Note duplication | `search-before-create` rule in `_conventions.md` |
| Hallucinated WikiLinks | Validation script runs after every write |
| Staleness | `last_verified` + compare to source `mtime` |
| Over-documentation | Max size per type enforced by `_conventions.md` |
| Format drift | Rigid templates + frontmatter lint |
| Semantic fragmentation | One canonical note per concept + MOC |
| Model collapse on rewrites | `_log.md` append-only + `source: code-analysis` vs `source: llm-inference` tag |

### `_conventions.md` = vault constitution

The LLM reads it **before every write**. Must contain: frontmatter schema, approved tag taxonomy, naming rules, search-before-create rule, size limits, template per type, linking rules.

---

## 9. External inspirations

- **Karpathy LLM Wiki** — `_index.md` + append-only `_log.md`
- **A-MEM** (NeurIPS 2025) — 2.4× better on multi-hop with Zettelkasten chunking
- **ArchRAG** — +12% quality, 250× token reduction via hierarchical retrieval
- **Cline Memory Bank** — hierarchical 6-file structure
- **AGENTS.md** (Linux Foundation) — cross-tool convention format

---

## 10. Machine-readable canonical sources

Content below is extracted at build-time into `src/vault/conventions/defaults.ts` by `scripts/generate-vault-schema-defaults.ts`. Do **not** edit the generated file directly — edit the blocks in this section and re-run `bun run generate:vault-schema`.

<!-- SCHEMA-VERSION: 1.0.0 -->

### 10.1 Canonical `_conventions.md`

<!-- CONVENTIONS-MD-BEGIN -->
# Vault Conventions

> The vault constitution. The LLM reads this file before every write. Derived from `.specs/project/VAULT-SCHEMA.md` §3–§8.

## Schema version

`1.0.0`

## Frontmatter schema

All notes carry a YAML frontmatter block delimited by `---` fences. Required fields (minimum):

- `title` — string
- `type` — one of: `module | concept | flow | decision | incident | feature | glossary | moc | system | risk`
- `tags` — array of kebab-case strings, 3–7 items
- `status` — one of: `draft | active | review | stable | deprecated | archived`
- `created` — ISO date (`YYYY-MM-DD`)
- `updated` — ISO date (`YYYY-MM-DD`)
- `confidence` — one of: `high | medium | low | speculative` (see Confidence tiers below)
- `summary` — one-line string, machine-readable
- `scope` — one of: `project | global`; optional in frontmatter (default `project` applied at write time, PIFA-01)
- `aliases` — optional array of strings
- `related` — optional array of WikiLinks (`"[[note-slug]]"`)

Type-specific additions:

- **module:** `source_path`, `language`, `layer`, `domain`, `depends_on`, `depended_by`, `exports`, `last_verified`
- **decision:** `decision_makers`, `supersedes`, `superseded_by`
- **flow:** `trigger`, `participants`
- **incident:** `severity`, `date_occurred`, `date_resolved`, `duration_minutes`, `root_cause`, `affected_modules`

Every field has exactly one type across the entire vault. Never use Dataview inline fields.

## Tag taxonomy

Predefined prefixes (kebab-case, 3–7 tags per note):

- `code/` → `code/architecture`, `code/api-design`, `code/testing`, `code/security`, `code/performance`
- `pattern/` → `pattern/creational`, `pattern/behavioral`, `pattern/concurrency`
- `lang/` → `lang/typescript`, `lang/python`, `lang/go`, `lang/sql`
- `domain/` → `domain/auth`, `domain/payments`, `domain/search`
- `layer/` → `layer/frontend`, `layer/backend`, `layer/infra`, `layer/data`

Tags classify and filter. WikiLinks express semantic relationships. They are complementary.

## Naming

Filenames are kebab-case with a type prefix:

- `adr-####-<slug>.md` (decisions)
- `flow-<slug>.md` (flows)
- `concept-<slug>.md` (concepts)
- `moc-<slug>.md` (MOCs)
- `module-<slug>.md` (modules)
- `incident-<slug>.md` (incidents)

Every note MUST have at least one incoming link. Zero incoming = orphan invisible to LLM navigation.

## Size limits

Token budgets per note type:

- `concept` / `glossary` — 200–500 tokens
- `module` / `pattern` — 400–800 tokens
- `flow` / `decision` — 500–1000 tokens
- `incident` — 300–800 tokens
- `moc` — variable (no upper cap)

Atomic notes overall: 300–500 words. No-RAG bucket: 500–1500 tokens. RAG chunk: 256–512 tokens.

## Confidence tiers (PIFA-06, F-2)

Every note's `confidence` uses one of four values, ordered from most to least trustworthy:

- **`high`** — Static-only ground truth: deterministic facts derived from code analysis (exports, imports, dependency edges, file paths). No LLM involvement. Cache-aside serves these without re-checking source.
- **`medium`** — Clean LLM-derived semantic content with successful structured-output validation. Mapper output for `summary`, `responsibilities`, `domain`, `layer` lands here. Cache-aside threshold is `≥ medium`.
- **`low`** — Fallback placeholders (LLM call failed and was retried), escape-hatch deferred content, or output the agent flagged as needing dev confirmation. Cache-aside ALWAYS re-analyzes.
- **`speculative`** — Hypothetical or exploratory content explicitly flagged as untrusted. Treated identically to `low` by the cache layer.

Provenance pairs with confidence: every `_log.md` entry tags `source: code-analysis` (deterministic write) or `source: llm-inference` (LLM-derived write).

## Scope (PIFA-01)

Every note carries a `scope` field declaring where it lives:

- **`project`** (default) — the project-local vault at `<repo>/.bridgeai/vault/`. Specific to one codebase.
- **`global`** — the dev's portable vault at `~/.bridgeai/global-vault/` (or `$BRIDGEAI_GLOBAL_VAULT`). Carried across projects. Used for principles, lessons, patterns, cross-project decisions.

`writeNote` dispatches by scope. Module notes (`type: module`) are inherently project-scoped — `type: module + scope: global` is rejected by the `type-scope-mismatch` rule. Cross-vault references use the `[[global:slug]]` namespace prefix (see PIF-E).

## Write-time rules

1. **search-before-create** — scan `_index.md` and existing titles/aliases before writing a new note; link to canonical if it exists.
2. **Hallucinated WikiLinks are rejected** — every `[[target]]` must resolve to an existing note or a note in the same write batch.
3. **Append-only `_log.md`** — every vault mutation adds an entry; tag entries with `source: code-analysis` or `source: llm-inference`.
4. **Template conformance** — each note type has a fixed section order (see §10.2). Deviation is a violation.
5. **Frontmatter field order is canonical** — the serializer enforces field order regardless of input order.
6. **Scope dispatch** — `writeNote` reads `scope` (default `project`) and routes to the matching vault; `scope: global` with no global vault configured returns a `no-global-vault-configured` violation without touching disk.
7. **Type-scope-mismatch** — `type: module + scope: global` is rejected; modules are inherently project-scoped.
<!-- CONVENTIONS-MD-END -->

### 10.2 Note-type templates

#### Module

<!-- TEMPLATE-MODULE-BEGIN -->
---
title: ""
type: module
source_path: ""
language: ""
layer: ""
domain: ""
depends_on: []
depended_by: []
exports: []
status: draft
created: ""
updated: ""
last_verified: ""
confidence: medium
summary: ""
tags: []
related: []
---

# <title>

> **TL;DR**: <one-line summary>

## Public API

## Internal design

## Dependencies

## Configuration

## Error handling
<!-- TEMPLATE-MODULE-END -->

#### Concept

<!-- TEMPLATE-CONCEPT-BEGIN -->
---
title: ""
type: concept
status: draft
created: ""
updated: ""
confidence: medium
summary: ""
tags: []
related: []
---

# <title>

> **TL;DR**: <one-line summary>

## How we use it

## Rules and conventions

## Trade-offs
<!-- TEMPLATE-CONCEPT-END -->

#### Flow

<!-- TEMPLATE-FLOW-BEGIN -->
---
title: ""
type: flow
trigger: ""
participants: []
status: draft
created: ""
updated: ""
confidence: medium
summary: ""
tags: []
related: []
---

# <title>

> **TL;DR**: <one-line summary>

## Numbered sequence

1.

## Error paths

| Step | Error | Handling |
|---|---|---|
|   |       |          |
<!-- TEMPLATE-FLOW-END -->

#### Decision (ADR)

<!-- TEMPLATE-DECISION-BEGIN -->
---
title: ""
type: decision
decision_makers: []
supersedes: []
superseded_by: []
status: draft
created: ""
updated: ""
confidence: medium
summary: ""
tags: []
related: []
---

# <title>

> **TL;DR**: <one-line summary>

## Context

## Decision

## Consequences

## Alternatives considered
<!-- TEMPLATE-DECISION-END -->

#### Incident

<!-- TEMPLATE-INCIDENT-BEGIN -->
---
title: ""
type: incident
severity: ""
date_occurred: ""
date_resolved: ""
duration_minutes: 0
root_cause: ""
affected_modules: []
status: draft
created: ""
updated: ""
confidence: medium
summary: ""
tags: []
related: []
---

# <title>

> **TL;DR**: <one-line summary>

## Timeline

## Root cause

## Impact

## Remediation

## Follow-up actions
<!-- TEMPLATE-INCIDENT-END -->

#### MOC (Map of Content)

<!-- TEMPLATE-MOC-BEGIN -->
---
title: ""
type: moc
status: draft
created: ""
updated: ""
confidence: medium
summary: ""
tags: []
related: []
---

# <title>

> **TL;DR**: <one-line summary>

## Key modules

## Key flows

## Key decisions

## Related concepts
<!-- TEMPLATE-MOC-END -->
