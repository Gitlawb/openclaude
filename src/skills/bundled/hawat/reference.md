---
name: hawat-reference
description: On-demand orchestration reference (phases, agents, quality, maturity, sessions, skills, LSP, AST patterns)
context: main
model: sonnet
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---

# Hawat Orchestration Reference

This skill provides detailed reference material moved out of CLAUDE.md to reduce
context window consumption. Load when you need detailed phase criteria, delegation
templates, completion checks, quality standards, maturity scoring, session continuity,
skill configuration, LSP operations, AST-grep patterns, or skill composition guidelines.

## Table of Contents

1. [Workflow Phases](#workflow-phases) — Phase criteria, gate conditions, decision trees
2. [Agent Definitions](#agent-definitions) — Delegation templates, 7-section dispatch format
3. [Exploration Patterns](#exploration-patterns) — Search strategies for codebase investigation
4. [Completion Checking](#completion-checking) — Anti-premature-stop patterns and verification
5. [Quality Standards](#quality-standards) — Quality gates and severity levels
6. [Maturity Assessment](#maturity-assessment) — Scoring rubric and behavioral adaptation
7. [Session Continuity](#session-continuity) — Checkpoint and recovery procedures
8. [Skills and Hooks](#skills-and-hooks) — Configuration details for all skills
9. [LSP Operations](#lsp-operations) — Semantic code operation reference
10. [AST-grep Patterns](#ast-grep-patterns) — Structural search and replace patterns
11. [Checkpoint System](#checkpoint-system) — Session state checkpointing
12. [Skill Composition](#skill-composition) — How skills compose and interact

---


## workflow phases

## Workflow Phases

Every task progresses through defined phases for consistent, high-quality outcomes.

### Overview

```
Request → Phase 0 → [Phase 1] → [Phase 2A] → Phase 2B → [Phase 2C] → Phase 3 → Done
                        ↑            ↑                       ↑
                   (complex)    (explore)              (failures)
```

### Phase Transitions

| From | To | Trigger |
|------|-----|---------|
| Phase 0 | Phase 1 | Open-ended request |
| Phase 0 | Phase 2B | Explicit request |
| Phase 0 | (answer) | Trivial request |
| Phase 1 | Phase 2A | Exploration needed |
| Phase 1 | Phase 2B | Sufficient context |
| Phase 2A | Phase 2B | Context gathered |
| Phase 2B | Phase 2C | 3 failures |
| Phase 2B | Phase 3 | Implementation done |
| Phase 2C | Phase 2B | Recovery successful |
| Phase 2C | Phase 3 | User intervention |
| Phase 3 | (done) | Verification passed |

---

### Phase 0: Intent Gate

**Purpose**: Classify and validate request before work begins.

**Always Execute This Phase First**

**Actions**:
1. Read and understand the request
2. Classify the request type:
   - **Trivial**: Simple question → Answer directly, skip other phases
   - **Explicit**: Clear implementation → Skip to Phase 2B
   - **Exploratory**: Needs investigation → Proceed to Phase 2A
   - **Open-ended**: Architectural → Proceed to Phase 1
   - **Ambiguous**: Unclear → AskUserQuestion, then re-classify

**Gate Criteria** (must be true to proceed):
- [ ] Request is clearly understood
- [ ] Scope boundaries are defined
- [ ] Success criteria are known

**If Gate Fails**: Use AskUserQuestion to clarify before proceeding.

---

### Phase 1: Codebase Assessment

**Purpose**: Evaluate project state for complex tasks.

**Triggers**:
- Open-ended requests
- Unfamiliar codebase
- Architectural decisions
- First time working on project

**Actions**:
1. Assess codebase maturity:
   - Check test coverage
   - Evaluate code consistency
   - Review documentation
   - Identify patterns

2. Document findings:
   - DISCIPLINED / TRANSITIONAL / LEGACY / GREENFIELD
   - Key patterns to follow
   - Dependencies to respect

3. Identify constraints:
   - Technology stack
   - Existing conventions
   - Integration points

**Gate Criteria**:
- [ ] Maturity level documented
- [ ] Key patterns identified
- [ ] Dependencies understood
- [ ] Constraints known

**If Already Assessed**: Reference existing assessment, don't repeat.

---

### Phase 2A: Exploration & Research

**Purpose**: Gather context through parallel investigation.

**Triggers**:
- Exploratory requests
- Insufficient context for implementation
- "Find", "where", "how does" questions
- Unknown file locations

**Actions**:
1. **Launch parallel exploration agents** (in SINGLE message):
   ```
   Task(Explore, sonnet, "Search codebase for [pattern]")
   Task(general-purpose, sonnet, "Research [external topic]")
   ```

2. **Synthesize findings**:
   - Combine internal and external results
   - Identify relevant files
   - Note patterns and conventions

3. **Determine if sufficient**:
   - Convergence: Same info from multiple sources
   - Sufficiency: Enough to proceed confidently
   - Iteration limit: Stop after 2 rounds with no new info

**Gate Criteria**:
- [ ] Relevant files identified
- [ ] Patterns understood
- [ ] Dependencies mapped
- [ ] Ready to implement

**Continue Exploring If**:
- Key information still missing
- Conflicting findings need resolution
- Under iteration limit

---

### Phase 2B: Implementation

**Purpose**: Execute the actual development work.

**Triggers**:
- Explicit requests (from Phase 0)
- Sufficient context gathered (from Phase 2A)
- Clear path forward

**Actions**:
1. **Create TodoWrite items** for multi-step work:
   - Break into atomic tasks
   - One deliverable per todo
   - Clear completion criteria

2. **Execute implementation**:
   - Handle core logic directly
   - Follow existing patterns exactly
   - Run quality checks after edits

3. **Delegate specialized work**:
   - UI/Frontend → Task(frontend-architect, opus)
   - Security review → Task(security-engineer, opus)
   - Complex analysis → Task(Plan, opus)

4. **Track progress**:
   - Update todo status
   - Mark complete only when verified
   - Never leave code broken

**Implementation Rules**:
- Match existing code style
- Run formatters and linters (hooks should do this)
- Verify each change works before proceeding
- Commit logical checkpoints (if requested)

**Gate Criteria**:
- [ ] All todos marked complete
- [ ] Quality checks pass
- [ ] Code is in working state

---

### Phase 2C: Failure Recovery

**Purpose**: Handle persistent failures gracefully.

**Trigger**: 3 consecutive failures on the same operation.

**Protocol**:

```
┌─────────┐
│  STOP   │ → Halt all file modifications immediately
└────┬────┘
     ↓
┌─────────┐
│ REVERT  │ → git checkout to last working state
└────┬────┘
     ↓
┌─────────┐
│DOCUMENT │ → Record in response:
└────┬────┘   • What was attempted
     │        • What failed
     │        • Error messages
     ↓
┌─────────┐
│ CONSULT │ → Task(Plan, opus, "Given these failures,
└────┬────┘                      suggest alternative approach")
     ↓
┌─────────┐
│ESCALATE │ → AskUserQuestion:
└─────────┘   "I've encountered persistent failures.
              Here's what happened: [summary]
              How would you like to proceed?"
```

**Recovery Rules**:
- Never continue hoping errors will resolve
- Never disable tests to make them pass
- Never ignore type errors
- Always investigate root cause
- Document lessons for future

**After Recovery**:
- If new approach found → Return to Phase 2B
- If user provides direction → Follow user guidance
- If insurmountable → Document and close gracefully

---

### Phase 3: Completion

**Purpose**: Verify and deliver results.

**Triggers**:
- Implementation complete (from Phase 2B)
- Recovery resolved (from Phase 2C)

**Actions**:

1. **TodoWrite Audit**:
   - Are ALL todos marked complete?
   - Were any skipped or forgotten?
   - If incomplete: CONTINUE, don't stop

2. **Quality Verification**:
{{#if-eq projectType "node"}}
   ```bash
   npm run lint    # Linting
   npm run test    # Tests
   npm run build   # Build
   ```
{{else}}
{{#if-eq projectType "typescript"}}
   ```bash
   npm run lint     # Linting
   npx tsc --noEmit # Type check
   npm run test     # Tests
   ```
{{else}}
{{#if-eq projectType "python"}}
   ```bash
   ruff check .   # Linting
   mypy .         # Type check
   pytest         # Tests
   ```
{{else}}
{{#if-eq projectType "go"}}
   ```bash
   go vet ./...   # Vet checks
   go test ./...  # Tests
   ```
{{else}}
{{#if-eq projectType "rust"}}
   ```bash
   cargo clippy   # Linting
   cargo test     # Tests
   ```
{{else}}
   ```bash
   # Run project-specific quality checks
   ```
{{/if-eq}}
{{/if-eq}}
{{/if-eq}}
{{/if-eq}}
{{/if-eq}}
   - Fix any failures before completing

3. **Deliverable Verification**:
   - Does output match requirements?
   - Were all requested changes made?
   - Is code in working state?

4. **State Cleanup**:
   - Remove temporary files
   - Clean up debug code
   - Ensure git status is appropriate

5. **Summary**:
   - What was accomplished
   - What changed (files, functionality)
   - Any notes or recommendations

**Gate Criteria**:
- [ ] All todos complete
- [ ] Quality checks pass
- [ ] Deliverables match requirements
- [ ] Summary provided


## agent definitions

## Agent Delegation

Use the Task tool with appropriate specialization to delegate work efficiently.

### Delegation Matrix

| Task Type | subagent_type | model | When to Use |
|-----------|---------------|-------|-------------|
| Codebase exploration | `Explore` | sonnet | Finding files, understanding structure, searching code |
| Research/documentation | `general-purpose` | sonnet | External lookups, reading docs, research |
| Architecture decisions | `Plan` | opus | Complex design, multi-component analysis, major refactoring |
| Implementation planning | `Plan` | opus | Feature design, refactoring strategy |
| Security review | `security-engineer` | opus | Vulnerability analysis, auth design |
| Performance analysis | `performance-engineer` | opus | Optimization, bottleneck analysis |
| Frontend work | `frontend-architect` | opus | UI/UX implementation, components |
| Backend design | `backend-architect` | opus | API design, data modeling |
| Implementation | (direct) | - | Execute yourself when task is clear |

---

### 7-Section Delegation Template

When delegating via the Task tool, structure prompts using this comprehensive template:

```
## 1. TASK
[Specific, atomic goal with single deliverable]
• One sentence, one goal
• Action verb first
• Measurable outcome
• Not decomposable into subtasks

## 2. EXPECTED OUTCOME
[Concrete, verifiable deliverables]
• What you'll receive back
• Include format expectations
• Quantify when possible

## 3. CONTEXT
• **Files**: [Relevant file paths - absolute or relative to project root]
• **Patterns**: [Existing conventions to follow]
• **Constraints**: [Limitations, boundaries, requirements]
• **Background**: [Why this task exists, what problem it solves]

## 4. MUST DO
• [Explicit requirement 1]
• [Explicit requirement 2]
• [Explicit requirement 3]
(Positive requirements - specific, observable actions)

## 5. MUST NOT DO
• [Forbidden action 1]
• [Forbidden action 2]
• Do NOT modify files outside the specified scope
• Do NOT spawn additional sub-agents
• Do NOT make assumptions about missing information
(Guards against common errors and scope creep)

## 6. TOOLS ALLOWED (optional)
[Whitelist of permitted tools, if constraining]
• Glob, Grep, Read (for exploration)
• Edit, Write (for implementation)
• Bash (for specific commands only)

## 7. SUCCESS CRITERIA
[How to verify the task is complete]
• [ ] Criterion 1
• [ ] Criterion 2
• [ ] Criterion 3
```

### Section Requirements

| Section | Required | Purpose |
|---------|----------|---------|
| 1. TASK | **Yes** | Defines what to accomplish |
| 2. EXPECTED OUTCOME | **Yes** | Defines deliverables |
| 3. CONTEXT | **Yes** | Provides necessary information |
| 4. MUST DO | **Yes** | Explicit requirements |
| 5. MUST NOT DO | **Yes** | Guards against errors |
| 6. TOOLS ALLOWED | No | Optional constraint |
| 7. SUCCESS CRITERIA | **Yes** | Verifies completion |

---

### Writing Effective Sections

#### TASK Section Tips
**Good**: "Find all files that import the UserService class"
**Bad**: "Look around the codebase and see what uses UserService and maybe fix some issues"

#### EXPECTED OUTCOME Tips
**Good**: "Return a list of file paths with line numbers where UserService is imported"
**Bad**: "Let me know what you find"

---

### Example Delegations

#### Example 1: Codebase Exploration (Explore Agent)

```javascript
Task({
  subagent_type: "Explore",
  model: "sonnet",
  description: "Find form useState usage",
  prompt: `## 1. TASK
Find all React components that use the useState hook for form handling.

## 2. EXPECTED OUTCOME
• List of file paths containing form-related useState usage
• For each file: component name and line numbers
• Brief summary of form patterns found

## 3. CONTEXT
• **Files**: src/components/**/*.tsx, src/pages/**/*.tsx
• **Patterns**: Project uses functional components with hooks
• **Background**: Planning to standardize form handling with react-hook-form

## 4. MUST DO
• Search all .tsx files in src/
• Include the specific useState variable names (e.g., formData, values)
• Group findings by directory

## 5. MUST NOT DO
• Do NOT modify any files
• Do NOT analyze node_modules
• Do NOT spend time on non-form useState usage

## 6. TOOLS ALLOWED
• Glob, Grep, Read

## 7. SUCCESS CRITERIA
• [ ] All relevant directories searched
• [ ] Form-related useState patterns identified
• [ ] Results organized by location`
})
```

#### Example 2: Architecture Planning (Plan Agent with opus)

```javascript
Task({
  subagent_type: "Plan",
  model: "opus",
  description: "Design multi-tenant schema",
  prompt: `## 1. TASK
Design the database schema for a multi-tenant SaaS application's user management system.

## 2. EXPECTED OUTCOME
• Entity-relationship diagram (text format)
• Table definitions with columns and types
• Relationship descriptions
• Multi-tenancy strategy recommendation

## 3. CONTEXT
• **Files**: Current schema at src/db/schema.prisma
• **Patterns**: Using Prisma ORM with PostgreSQL
• **Constraints**: Must support 1000+ tenants, GDPR compliance required
• **Background**: Migrating from single-tenant to multi-tenant architecture

## 4. MUST DO
• Consider row-level security vs. schema separation
• Include audit fields (createdAt, updatedAt, deletedAt)
• Plan for tenant isolation
• Address GDPR data deletion requirements

## 5. MUST NOT DO
• Do NOT implement the schema (planning only)
• Do NOT modify existing files
• Do NOT make technology change recommendations

## 7. SUCCESS CRITERIA
• [ ] All user management entities identified
• [ ] Multi-tenancy approach justified
• [ ] GDPR compliance addressed
• [ ] Scalability considered`
})
```

#### Example 3: Security Review (security-engineer Agent)

```javascript
Task({
  subagent_type: "security-engineer",
  model: "opus",
  description: "Review auth middleware",
  prompt: `## 1. TASK
Review the authentication middleware for security vulnerabilities.

## 2. EXPECTED OUTCOME
• List of identified vulnerabilities with severity ratings (Critical/High/Medium/Low)
• Location of each issue (file:line)
• Recommended fixes for each issue
• Overall security assessment

## 3. CONTEXT
• **Files**: src/middleware/auth.ts, src/utils/jwt.ts
• **Patterns**: Express middleware, JWT-based auth
• **Constraints**: Must remain backwards compatible
• **Background**: Preparing for security audit

## 4. MUST DO
• Check for OWASP Top 10 vulnerabilities
• Verify JWT implementation best practices
• Check for timing attacks in token validation
• Review error messages for information leakage

## 5. MUST NOT DO
• Do NOT modify any code
• Do NOT test against production
• Do NOT expose any secrets in your response

## 6. TOOLS ALLOWED
• Read, Grep, Glob

## 7. SUCCESS CRITERIA
• [ ] All auth-related files reviewed
• [ ] Each finding has severity rating
• [ ] Actionable recommendations provided
• [ ] No false positives from superficial analysis`
})
```

#### Example 4: Implementation Task (general-purpose Agent)

```javascript
Task({
  subagent_type: "general-purpose",
  model: "opus",
  description: "Add user validation",
  prompt: `## 1. TASK
Add input validation to the createUser API endpoint.

## 2. EXPECTED OUTCOME
• Validation logic added to src/api/users.ts
• Validation schema defined using Zod
• Error responses standardized
• Tests added for validation cases

## 3. CONTEXT
• **Files**: src/api/users.ts, src/validators/index.ts
• **Patterns**: Project uses Zod for validation, see existing validators
• **Constraints**: Must return 400 with { error: string, field: string } format

## 4. MUST DO
• Validate email format
• Validate password strength (min 8 chars, 1 number, 1 special)
• Validate username (alphanumeric, 3-20 chars)
• Follow existing Zod patterns in validators/

## 5. MUST NOT DO
• Do NOT change the API response format for success cases
• Do NOT modify other endpoints
• Do NOT add new dependencies

## 7. SUCCESS CRITERIA
• [ ] All three fields validated
• [ ] Error format matches specification
• [ ] Existing tests still pass
• [ ] New validation tests added`
})
```

#### Example 5: Quick Research (general-purpose with sonnet)

```javascript
Task({
  subagent_type: "general-purpose",
  model: "sonnet",
  description: "Check TypeScript strict mode",
  prompt: `## 1. TASK
Find the correct way to configure TypeScript strict mode in this project.

## 2. EXPECTED OUTCOME
• Current tsconfig.json strict settings
• Recommendation for enabling strict mode
• List of potential breaking changes

## 3. CONTEXT
• **Files**: tsconfig.json, src/**/*.ts
• **Background**: Considering enabling strict mode for better type safety

## 4. MUST DO
• Read current tsconfig.json
• Check for any existing strict-related settings
• Identify files that might have issues with strict mode

## 5. MUST NOT DO
• Do NOT modify tsconfig.json
• Do NOT spend excessive time on this

## 7. SUCCESS CRITERIA
• [ ] Current config documented
• [ ] Strict mode recommendation provided`
})
```

---

### Model Selection Guidelines

#### Quick Reference Matrix

| Task Type | Model | Rationale |
|-----------|-------|-----------|
| File search, pattern matching | sonnet | Fast, sufficient capability for exploration |
| Simple research questions | sonnet | Low complexity, quick turnaround |
| Codebase exploration | sonnet | Pattern matching doesn't need deep reasoning |
| Standard implementation | opus | Full capability for code generation |
| Documentation writing | opus | Good language ability for quality docs |
| Code review | opus | Thorough analysis of patterns and issues |
| Architecture decisions | opus | Maximum reasoning for complex trade-offs |
| Complex debugging | opus | Deep analysis required |
| Multi-component design | opus | System-level thinking needed |
| Error recovery consultation | opus | Strategic problem-solving |

#### Model Selection Decision Tree

```
┌─────────────────────────────────────┐
│         SELECT MODEL                 │
└─────────────────────────────────────┘
                │
                ▼
    ┌─────────────────────┐
    │ Is it search/lookup │
    │ with clear answer?  │──Yes──→ sonnet
    └─────────────────────┘
                │ No
                ▼
    ┌─────────────────────┐
    │ Is it exploration   │
    │ or simple research? │──Yes──→ sonnet
    └─────────────────────┘
                │ No
                ▼
              opus
        (default choice)
```

#### Detailed Selection Rules

**Use sonnet for**:
- Codebase exploration (Task(Explore))
- Finding files by pattern
- Searching for function definitions
- Locating imports/dependencies
- Quick structural analysis
- Simple documentation lookup
- Quick fact-checking

**Use opus for**:
- Implementation tasks (code generation)
- Writing new functions
- Implementing features
- Refactoring code
- Bug fixes
- Documentation writing
- Code review
- Architecture decisions
- System design
- Technology selection
- Trade-off analysis
- Migration planning
- Complex debugging
- Multi-file issues
- Race conditions
- Performance mysteries
- Error recovery (3-strikes CONSULT)
- Strategic problem-solving

---

### Cost Tier Documentation

#### Tier Overview

| Tier | Model | Relative Cost | Capability | Best For |
|------|-------|---------------|------------|----------|
| Standard | sonnet | $ | Great for simple tasks | Exploration, search, research |
| Premium | opus | $$ | Best for most tasks | Implementation, architecture, debugging |

#### When to Upgrade (sonnet → opus)

- Task requires code generation
- Task requires implementation
- Architectural decisions needed
- Complex trade-off analysis
- Multi-system reasoning required
- 3-strikes error recovery triggered
- Strategic planning needed

#### When to Downgrade (opus → sonnet)

- Pure search/exploration
- Simple lookups
- File pattern matching
- Quick research questions
- Reading documentation

#### Cost-Aware Patterns

**Start Standard, Escalate if Needed**:
```javascript
// First try with sonnet for exploration
Task({ subagent_type: "Explore", model: "sonnet", prompt: "Find auth files" })

// If analysis needed, use opus
Task({ subagent_type: "Plan", model: "opus", prompt: "Analyze auth architecture" })
```

**Parallel Exploration Tasks**:
```javascript
// Multiple sonnet tasks in parallel is cost-effective
Task({ subagent_type: "Explore", model: "sonnet", prompt: "Find user files" })   // parallel
Task({ subagent_type: "Explore", model: "sonnet", prompt: "Find auth files" })   // parallel
Task({ subagent_type: "Explore", model: "sonnet", prompt: "Find config files" }) // parallel
```

#### Anti-Patterns

- ❌ Use opus for simple file searches
- ❌ Use sonnet for code generation
- ❌ Retry with same model after failure (consider context, not model change)
- ❌ Parallel opus tasks when sequential would work

**Do**:
- ✅ Match model to task complexity
- ✅ Use sonnet for exploration, opus for implementation
- ✅ Use opus confidently when implementation is needed
- ✅ Parallel sonnet tasks for broad exploration

---

### When to Delegate

**Delegate when**:
- Task requires specialized knowledge (security, performance, frontend, backend)
- Task benefits from isolated context (exploration)
- You need external research
- Complex analysis is needed
- Multiple perspectives would help
- Task is parallelizable

**Handle directly when**:
- Task is straightforward and context is loaded
- Delegation overhead exceeds benefit
- Simple code changes
- Single-file edits
- Already have sufficient context

---

### Parallel Delegation

When tasks are independent, delegate in parallel:

```javascript
// Good: Independent searches in parallel
Task({ subagent_type: "Explore", model: "sonnet", prompt: "Find all API routes" })
Task({ subagent_type: "Explore", model: "sonnet", prompt: "Find all database models" })
Task({ subagent_type: "Explore", model: "sonnet", prompt: "Find all test files" })
```

**When to parallelize**:
- Independent searches
- Multiple file explorations
- Gathering diverse context
- Non-overlapping scopes

**When NOT to parallelize**:
- Sequential dependencies exist
- Modifying same files
- Results inform next steps
- Order matters for correctness


## exploration patterns

## Exploration Patterns

### Parallel Agent Pattern

When exploration is needed, launch multiple agents in a **SINGLE message** for efficiency:

```
┌─────────────────────────────────────────┐
│     SINGLE MESSAGE WITH MULTIPLE TASKS   │
│                                         │
│  Task(Explore, sonnet, "internal query") │
│  Task(general-purpose, sonnet, "research")│
│                                         │
│  → Both execute in parallel              │
│  → Results returned together             │
└─────────────────────────────────────────┘
```

---

### Pattern: Internal + External Search

**Use When**: Need both codebase context and external documentation.

```javascript
// Launch both in the SAME message
Task({
  subagent_type: "Explore",
  model: "sonnet",
  prompt: `## 1. TASK
Search for all implementations of user authentication.

## 2. EXPECTED OUTCOME
- File paths with auth-related code
- Function/class names
- Brief description of each approach

## 3. CONTEXT
- Files: src/**/*.ts
- Looking for: login, logout, session, token handling

## 4. MUST DO
- Search all source files
- Include test files if they show usage patterns

## 5. MUST NOT DO
- Do NOT modify files
- Do NOT analyze node_modules

## 7. SUCCESS CRITERIA
- [ ] All auth-related files found
- [ ] Patterns identified`
})

Task({
  subagent_type: "general-purpose",
  model: "sonnet",
  prompt: `## 1. TASK
Research best practices for JWT refresh token rotation.

## 2. EXPECTED OUTCOME
- Key recommendations
- Security considerations
- Common implementation patterns

## 3. CONTEXT
- Building Node.js/Express backend
- Using JWT for authentication

## 4. MUST DO
- Focus on security best practices
- Include token storage recommendations

## 5. MUST NOT DO
- Don't provide full implementation code
- Don't recommend specific libraries without justification

## 7. SUCCESS CRITERIA
- [ ] Best practices identified
- [ ] Security concerns addressed`
})
```

---

### Pattern: Multi-Location Search

**Use When**: Need to search multiple areas of codebase.

```javascript
// Launch all in same message for parallel execution
Task(Explore, sonnet, "Search src/api/ for endpoint definitions")
Task(Explore, sonnet, "Search src/middleware/ for auth checks")
Task(Explore, sonnet, "Search src/utils/ for validation helpers")
```

---

### Pattern: Code + Tests Search

**Use When**: Understanding both implementation and expected behavior.

```javascript
// Both searches run in parallel
Task(Explore, sonnet, "Find UserService class implementation")
Task(Explore, sonnet, "Find tests for UserService")
```

---

### Anti-Patterns

**DON'T**: Launch agents sequentially when parallel would work

```javascript
// BAD - Sequential, slow
result1 = Task(Explore, sonnet, "query 1")
// ... wait ...
result2 = Task(Explore, sonnet, "query 2")

// GOOD - Parallel, fast (same message)
Task(Explore, sonnet, "query 1")
Task(Explore, sonnet, "query 2")
```

**DON'T**: Use heavy models for simple exploration

```javascript
// BAD - opus for simple search
Task(Explore, opus, "Find config files")

// GOOD - sonnet is sufficient for exploration
Task(Explore, sonnet, "Find config files")
```

---

### Convergent Search Strategy

Exploration should be efficient. Know when to stop.

#### Termination Conditions

| Condition | Description | Action |
|-----------|-------------|--------|
| **Convergence** | Same info from multiple sources | Stop exploring |
| **Sufficiency** | Enough context to proceed | Stop exploring |
| **Iteration Limit** | 2 searches with no new useful info | Stop exploring |
| **Explicit Answer** | Direct answer found | Stop exploring |

#### Convergence Detection

Exploration has converged when:
- Multiple agents return same files
- Internal and external search align
- Repeated patterns emerge

**Example**:
```
Search 1: Found auth in src/auth/login.ts, src/auth/logout.ts
Search 2: Found auth in src/auth/login.ts, src/auth/session.ts
Search 3: Found auth in src/auth/login.ts, src/auth/logout.ts

→ Convergence: src/auth/ is clearly the auth location
→ Stop exploring, proceed to implementation
```

#### Sufficiency Check

Before continuing exploration, ask:

1. **Do I know WHERE to make changes?**
   - Yes → Sufficient for implementation
   - No → Continue exploring

2. **Do I know WHAT changes to make?**
   - Yes → Sufficient for implementation
   - No → May need external research

3. **Do I understand the PATTERNS to follow?**
   - Yes → Sufficient for implementation
   - No → Continue exploring or ask user

#### Iteration Limit

```
Round 1: Search for X
         → Found files A, B, C

Round 2: Search for more context on A
         → Found same info as Round 1 (no new data)

→ Iteration limit reached
→ Proceed with what we have
```

**Maximum 2-3 exploration rounds** unless:
- User explicitly asks for more
- New information keeps emerging
- Critical context still missing

#### Decision Tree

```
┌─────────────────────────────────┐
│   After Each Exploration Round   │
└─────────────────────────────────┘
              │
              ▼
    ┌─────────────────┐
    │ Is convergence  │
    │ achieved?       │──Yes──→ STOP: Proceed to implementation
    └─────────────────┘
              │ No
              ▼
    ┌─────────────────┐
    │ Is context      │
    │ sufficient?     │──Yes──→ STOP: Proceed to implementation
    └─────────────────┘
              │ No
              ▼
    ┌─────────────────┐
    │ Reached         │
    │ iteration limit?│──Yes──→ STOP: Proceed with current info
    └─────────────────┘           or ask user for guidance
              │ No
              ▼
         CONTINUE: Launch next round
```

#### Exploration Scope Guide

| Scope | When to Use | Max Iterations |
|-------|-------------|----------------|
| **Narrow** | Known file/function | 1 |
| **Medium** | Known directory | 2 |
| **Wide** | Unknown location | 3 |
| **Research** | External docs needed | 2 |


## completion checking

## Completion Checking Protocol

### Before Ending ANY Multi-Step Task

Execute this checklist before declaring work complete:

#### 1. TodoWrite Audit

```
┌─────────────────────────────────────────┐
│           TODO AUDIT                     │
├─────────────────────────────────────────┤
│ ☐ Are ALL todos marked complete?        │
│ ☐ Were any todos skipped?               │
│ ☐ Were any todos added and forgotten?   │
├─────────────────────────────────────────┤
│ If ANY incomplete → CONTINUE WORKING    │
│ Do NOT stop until all are done          │
└─────────────────────────────────────────┘
```

**Check**:
- Review each todo item
- Verify "completed" status is accurate
- Ensure no items were forgotten mid-stream

**If Incomplete**:
- Return to implementation
- Complete remaining items
- Do NOT ask user if they want to stop

#### 2. Quality Verification

```
┌─────────────────────────────────────────┐
│         QUALITY CHECKS                   │
├─────────────────────────────────────────┤
│ ☐ Did linters pass?                     │
│ ☐ Did type checks pass?                 │
│ ☐ Did tests pass? (if applicable)       │
│ ☐ Did build succeed? (if applicable)    │
├─────────────────────────────────────────┤
│ If ANY failed → FIX before completing   │
└─────────────────────────────────────────┘
```

**Run These Commands** (as appropriate):
{{#if-eq projectType "node"}}
```bash
npm run lint       # Linting
npm run test       # Tests
npm run build      # Build
```
{{else}}
{{#if-eq projectType "typescript"}}
```bash
npm run lint       # Linting
npx tsc --noEmit   # Type check
npm run test       # Tests
```
{{else}}
{{#if-eq projectType "python"}}
```bash
ruff check .       # Linting
mypy .             # Type check
pytest             # Tests
```
{{else}}
{{#if-eq projectType "go"}}
```bash
go vet ./...       # Vet checks
go test ./...      # Tests
```
{{else}}
{{#if-eq projectType "rust"}}
```bash
cargo clippy       # Linting
cargo test         # Tests
```
{{else}}
```bash
# Run project-specific quality checks
```
{{/if-eq}}
{{/if-eq}}
{{/if-eq}}
{{/if-eq}}
{{/if-eq}}

**If Failures**:
- Fix the issues
- Re-run checks
- Only complete when passing

#### 3. Deliverable Check

```
┌─────────────────────────────────────────┐
│       DELIVERABLE VERIFICATION           │
├─────────────────────────────────────────┤
│ ☐ Does output match requirements?       │
│ ☐ Were ALL requested changes made?      │
│ ☐ Is code in working state?             │
│ ☐ Does it do what user asked for?       │
├─────────────────────────────────────────┤
│ If gaps exist → ADDRESS before stopping │
└─────────────────────────────────────────┘
```

**Compare Against Original Request**:
- Re-read the user's request
- Check each requirement explicitly
- Verify nothing was missed

#### 4. State Verification

```
┌─────────────────────────────────────────┐
│         STATE CHECK                      │
├─────────────────────────────────────────┤
│ ☐ Is codebase in clean state?           │
│ ☐ Should changes be committed?          │
│ ☐ Are temporary files cleaned up?       │
│ ☐ Is any debug code removed?            │
├─────────────────────────────────────────┤
│ Clean up before finishing               │
└─────────────────────────────────────────┘
```

**Clean Up**:
- Remove console.log/print debug statements
- Delete temporary files
- Remove commented-out code (unless intentional)

---

### Completion Rules

#### NEVER Rules

These rules are absolute. No exceptions.

| Rule | Consequence if Violated |
|------|-------------------------|
| **NEVER stop with incomplete todos** | Work continues incomplete |
| **NEVER stop with failing tests** | Broken code delivered |
| **NEVER stop with broken code** | Unusable deliverable |
| **NEVER stop with lint errors** | Quality degraded |
| **NEVER stop without verifying** | Requirements may be missed |

#### ALWAYS Rules

| Rule | Benefit |
|------|---------|
| **ALWAYS verify deliverables match request** | User gets what they asked for |
| **ALWAYS run quality checks** | Consistent code quality |
| **ALWAYS clean up before finishing** | Professional deliverable |
| **ALWAYS summarize what was accomplished** | User understands what changed |

#### The Summary

Every completed task should end with a summary:

```markdown
## Summary

### What Was Done
- [Specific change 1]
- [Specific change 2]
- [Specific change 3]

### Files Changed
- `path/to/file1.ts` - [description]
- `path/to/file2.ts` - [description]

### Quality Status
- ✅ Lint: Passing
- ✅ Tests: Passing (12/12)
- ✅ Build: Successful

### Notes
- [Any important observations]
- [Recommendations for future work]
```

#### Premature Stop Prevention

If tempted to stop early, ask yourself:

1. **"Are there incomplete todos?"**
   - Yes → Keep working
   - No → Continue to next check

2. **"Did all quality checks pass?"**
   - No → Fix and re-run
   - Yes → Continue to next check

3. **"Did I deliver what was requested?"**
   - No → Complete the request
   - Yes → Continue to next check

4. **"Is the state clean?"**
   - No → Clean up first
   - Yes → OK to complete

**Only when ALL answers lead to "continue" can you stop.**

#### Exception: User Interruption

The ONLY valid reason to stop before completion:

- User explicitly asks to stop
- User redirects to different task
- User indicates scope change

Even then:
- Document current state
- Note what remains incomplete
- Summarize progress so far


## quality standards

## Quality Standards

### Code Quality Rules

1. **Match existing style exactly**
   - Indentation (tabs vs spaces, count)
   - Naming conventions (camelCase, snake_case)
   - File organization patterns
   - Import ordering and grouping

2. **No TODO comments for core functionality**
   - If it's needed, implement it now
   - TODOs only for nice-to-have enhancements
   - Never TODO for requested features
   - No "implement later" placeholders

3. **No placeholder implementations**
   - Every function must work as specified
   - No `throw new Error("Not implemented")`
   - No `pass` or `...` for core logic
   - Complete or don't start

4. **Run quality checks before completing**
   - Linters must pass
   - Type checking must pass
   - Existing tests must pass
   - Format code after edits

### Quality Check Sequence

Before marking any code task complete, execute in order:

```
1. Save all files
2. Run formatter (prettier, black, gofmt, rustfmt)
3. Run linter (eslint, ruff, golint, clippy)
4. Run type checker (tsc, mypy, go vet)
5. Run tests (jest, pytest, go test, cargo test)
6. Verify no regressions introduced
```

### Testing Requirements

- **Run existing tests** before and after changes
- **Add tests** for new functionality (when test infrastructure exists)
- **Don't modify tests** to make them pass without fixing code
- **Don't skip tests** to achieve green build
- **Don't delete tests** that expose bugs

### Documentation Standards

- Update relevant docs when changing behavior
- Add comments only for non-obvious logic
- Keep inline comments minimal and meaningful
- Update README if public API changes
- Document architectural decisions in ADRs

### Version Control

- Check `git status` before starting work
- Commit frequently with meaningful messages
- Create feature branches for larger changes
- Never commit directly to main/master
- Ensure commits are atomic and focused

### Quality Checklist

Before marking work complete, verify:

- [ ] Code follows existing patterns
- [ ] All tests pass
- [ ] Linter passes without new warnings
- [ ] Type checking passes
- [ ] Documentation updated (if needed)
- [ ] No debug code or console.logs left behind
- [ ] Changes reviewed for security issues
- [ ] No hardcoded secrets or credentials
- [ ] Edge cases considered
- [ ] Error handling is appropriate

### Language-Specific Standards

**JavaScript/TypeScript**:
- Run `npm test` or `npm run test`
- Run `npm run lint` if available
- Run `npx tsc --noEmit` for TypeScript

**Python**:
- Run `pytest` or `python -m pytest`
- Run `ruff check .` or `black --check .`
- Run `mypy .` if configured

**Go**:
- Run `go test ./...`
- Run `go vet ./...`
- Run `gofmt -l .`

**Rust**:
- Run `cargo test`
- Run `cargo clippy`
- Run `cargo fmt --check`


## maturity assessment

## Codebase Maturity Assessment

### Why Maturity Matters

Different codebases require different approaches:
- **Disciplined** codebases have patterns that must be followed exactly
- **Transitional** codebases are evolving and need careful balance
- **Legacy** codebases need conservative, incremental changes
- **Greenfield** projects can establish best practices from the start

Assess maturity when first working with a codebase to calibrate behavior appropriately.

---

### Maturity Levels

| Level | Description | Indicators | Approach |
|-------|-------------|------------|----------|
| **DISCIPLINED** | Well-maintained, consistent patterns | High test coverage, enforced style, clear architecture | Follow existing patterns EXACTLY |
| **TRANSITIONAL** | Evolving codebase, mixed patterns | Partial coverage, some legacy code, ongoing improvements | Respect existing, introduce new carefully |
| **LEGACY** | Technical debt, inconsistent patterns | Low coverage, varied styles, limited docs | Be conservative, propose improvements |
| **GREENFIELD** | New project, no existing patterns | Empty or minimal codebase | Establish best practices from start |

---

### Level Indicators

#### DISCIPLINED Codebase

**Observable Indicators**:
- [ ] Test coverage > 70%
- [ ] Consistent code style across all files
- [ ] Clear directory structure with logical organization
- [ ] Comprehensive documentation (README, API docs, inline comments)
- [ ] CI/CD with quality gates enforced
- [ ] Type safety strictly enforced
- [ ] Linting/formatting automated and consistent

**Behavioral Adjustments**:
- Match existing patterns exactly - don't introduce new patterns
- Follow established conventions precisely
- All changes require corresponding tests
- Respect existing architecture - propose changes through proper channels
- Documentation updates required when behavior changes

#### TRANSITIONAL Codebase

**Observable Indicators**:
- [ ] Test coverage 30-70%
- [ ] Mix of old and new patterns
- [ ] Some legacy code remaining in older areas
- [ ] Partial documentation (README exists, some inline docs)
- [ ] CI exists but may have gaps
- [ ] Types partially enforced

**Behavioral Adjustments**:
- Follow new patterns for new code
- Respect legacy patterns in old areas
- Propose cleanups when touching old code
- Add tests for new functionality
- Gradual improvement is acceptable
- Document patterns as you discover them

#### LEGACY Codebase

**Observable Indicators**:
- [ ] Test coverage < 30%
- [ ] Inconsistent styles across files
- [ ] Unclear or undocumented architecture
- [ ] Minimal or outdated documentation
- [ ] Technical debt visible everywhere
- [ ] Missing or inconsistent types

**Behavioral Adjustments**:
- Be very conservative with changes
- Document unexpected behaviors when found
- Add tests before making modifications
- Propose but don't force cleanups
- Extra verification before and after changes
- Small, incremental improvements preferred
- Never assume code behavior - verify everything

#### GREENFIELD Project

**Observable Indicators**:
- [ ] New or nearly empty project
- [ ] No established patterns yet
- [ ] Fresh start opportunity
- [ ] Minimal existing code to reference

**Behavioral Adjustments**:
- Establish best practices immediately
- Set up proper structure from the start
- Implement comprehensive testing from day one
- Create documentation as you go
- Use modern patterns and tools
- Set quality standards early

---

### Maturity Assessment Checklist

Use this checklist when first working with a codebase:

#### Step 1: Quick Scan

Run these commands to gather initial data:

```bash
# Check for test files
find . -name "*test*" -o -name "*spec*" | grep -v node_modules | wc -l

# Check for config files (quality tooling)
ls -la *.config.* .eslintrc* .prettierrc* pyproject.toml Cargo.toml 2>/dev/null

# Check for CI/CD
ls -la .github/workflows/ .gitlab-ci.yml .circleci/ 2>/dev/null

# Check for type definitions (TypeScript, Python typed)
find . -name "*.d.ts" -o -name "py.typed" | grep -v node_modules | wc -l

# Check documentation
ls -la README* docs/ CONTRIBUTING* 2>/dev/null
```

#### Step 2: Evaluate Criteria

| Criterion | Score | Your Notes |
|-----------|-------|------------|
| **Test Coverage** | | |
| - High (>70%) | +3 | |
| - Medium (30-70%) | +2 | |
| - Low (<30%) | +1 | |
| - None | 0 | |
| **Code Consistency** | | |
| - Very consistent | +3 | |
| - Mostly consistent | +2 | |
| - Mixed | +1 | |
| - Inconsistent | 0 | |
| **Documentation** | | |
| - Comprehensive | +3 | |
| - Partial | +2 | |
| - Minimal | +1 | |
| - None | 0 | |
| **CI/CD** | | |
| - Full pipeline with quality gates | +2 | |
| - Basic CI (tests only) | +1 | |
| - None | 0 | |
| **Type Safety** | | |
| - Strict types enforced | +2 | |
| - Partial types | +1 | |
| - No types | 0 | |

**Total Score: ___/13**

#### Step 3: Determine Level

| Score Range | Maturity Level |
|-------------|----------------|
| 10-13 | DISCIPLINED |
| 6-9 | TRANSITIONAL |
| 3-5 | LEGACY |
| 0-2 | Check if GREENFIELD |

---

### Quick Assessment Questions

If you can't run commands, answer these questions:

1. **Are there test files visible?**
   - Many → Likely DISCIPLINED or TRANSITIONAL
   - Some → Likely TRANSITIONAL
   - Few/None → Likely LEGACY

2. **Is there a linter/formatter config?**
   - Yes, actively used → Higher maturity
   - Exists but inconsistent → TRANSITIONAL
   - None → LEGACY

3. **Is the code consistently styled?**
   - Yes → DISCIPLINED
   - Mostly → TRANSITIONAL
   - No → LEGACY

4. **Is there documentation?**
   - README + docs folder → Higher maturity
   - Just README → TRANSITIONAL
   - Minimal/None → LEGACY

5. **Is this a new project?**
   - Yes, mostly empty → GREENFIELD

---

### Document Assessment in Project Context

After assessment, document in the project-specific section:

```markdown
## Codebase Maturity: [LEVEL]

Assessed on: [DATE]

### Assessment Summary
- Test coverage: [high/medium/low/none]
- Code consistency: [consistent/mixed/inconsistent]
- Documentation: [comprehensive/partial/minimal/none]
- CI/CD: [full/basic/none]
- Type safety: [strict/partial/none]
- Score: [X]/13

### Notable Observations
[Any specific observations about the codebase that affect approach]

### Approach Guidelines
[Specific guidelines based on maturity level and project characteristics]
```

---

### Maturity-Aware Behavior Summary

| Action | DISCIPLINED | TRANSITIONAL | LEGACY | GREENFIELD |
|--------|-------------|--------------|--------|------------|
| **New patterns** | Never without discussion | Carefully in new code | Avoid | Establish best practices |
| **Test changes** | Required | Required for new | Add before modifying | Required from start |
| **Documentation** | Update when behavior changes | Add when missing | Document discoveries | Create as you go |
| **Refactoring** | Follow existing patterns | Gradual improvement | Small incremental | Set good patterns |
| **Style** | Match exactly | Match local style | Improve when touching | Establish standards |


## session continuity

## Session Continuity

### Session Start Protocol

When beginning a new session or after context compaction:

#### Step 1: Read Project Context

```bash
# Conceptually, do this:
Read CLAUDE.md         # Project orchestration rules
Read .claude/context.md  # If exists, session context
```

**Extract**:
- Project type and maturity
- Key patterns to follow
- Any project-specific rules

#### Step 2: Check Existing Todos

```
┌─────────────────────────────────────────┐
│     CHECK FOR EXISTING WORK              │
├─────────────────────────────────────────┤
│ Are there incomplete todos?             │
│                                         │
│ If YES:                                 │
│   → Review what was being worked on     │
│   → Understand current state            │
│   → Resume from where left off          │
│                                         │
│ If NO:                                  │
│   → Ready for new work                  │
└─────────────────────────────────────────┘
```

#### Step 3: Review Recent Changes

```bash
# Check git status
git status

# See recent commits
git log --oneline -5

# Check for uncommitted changes
git diff --stat
```

**Determine**:
- Any work in progress?
- Uncommitted changes to address?
- Recent context to be aware of?

#### Step 4: Establish Session Context

Before starting new work:
- Note current objectives
- Identify files likely to be modified
- Check for any blocking issues

#### Quick Start Checklist

```markdown
Session Start:
☐ Read CLAUDE.md (project rules)
☐ Check for existing todos
☐ Review git status
☐ Understand current project state
☐ Ready to receive user request
```

#### Resuming Interrupted Work

If previous session was interrupted:

1. **Read any session notes** in .claude/context.md
2. **Check todo status** for what was in progress
3. **Review changed files** to understand state
4. **Inform user** of found state:
   ```
   "I see there was work in progress on [X].
   The todos show [Y] was being worked on.
   Would you like me to continue from there?"
   ```

---

### Session End Protocol

Before ending a session (or when user indicates they're done):

#### Step 1: Ensure Completion

```
┌─────────────────────────────────────────┐
│         COMPLETION CHECK                 │
├─────────────────────────────────────────┤
│ ☐ All todos complete OR documented?     │
│ ☐ Quality checks passing?               │
│ ☐ No broken code left behind?           │
└─────────────────────────────────────────┘
```

**If incomplete work exists**:
- Ask if user wants to continue
- Or document what remains

#### Step 2: Summarize Progress

Provide a clear summary of the session:

```markdown
## Session Summary

### Completed
- [Task 1]: [Brief description]
- [Task 2]: [Brief description]

### Files Modified
- `file1.ts`: [What changed]
- `file2.ts`: [What changed]

### Status
- Code: Working / Has issues
- Tests: Passing / Failing / N/A
- Commits: Made / Pending
```

#### Step 3: Note Pending Work

If anything remains:

```markdown
### Pending Work
- [ ] [Incomplete task 1]
- [ ] [Incomplete task 2]

### Context for Next Session
- Currently working on: [description]
- Next step would be: [description]
- Key files: [paths]
```

#### Step 4: Clean State

Before truly ending:

```
┌─────────────────────────────────────────┐
│         STATE CLEANUP                    │
├─────────────────────────────────────────┤
│ ☐ Remove temporary files                │
│ ☐ Remove debug statements (if added)    │
│ ☐ Code is in runnable state             │
│ ☐ No half-implemented features          │
└─────────────────────────────────────────┘
```

**Golden Rule**: Leave the codebase better than (or at least as good as) you found it.

#### Quick End Checklist

```markdown
Session End:
☐ All work complete or documented
☐ Summary provided
☐ Pending work noted (if any)
☐ State is clean
☐ User informed
```

---

### State Persistence Methods

#### TodoWrite Persistence
- Todos automatically persist across conversation
- Always check for existing todos at start
- Use todos as continuity mechanism

#### File-Based State

For critical information that must survive:

```markdown
# .claude/context.md

## Current Work
[What's being worked on]

## Key Decisions
- [Decision 1]: [Rationale]
- [Decision 2]: [Rationale]

## Next Steps
- [Step 1]
- [Step 2]

## Important Files
- [Path]: [Why important]
```

#### Critical Context (Compaction-Safe)

```markdown
# .claude/critical-context.md

## MUST REMEMBER
- [Absolutely critical point 1]
- [Absolutely critical point 2]

## CURRENT OBJECTIVE
[Single sentence describing current goal]

## KEY FILES
- [Path 1]
- [Path 2]
```


## skills and hooks

## Hawat Skills (Claude Code 2.1+)

### Available Skills

Hawat provides 11 specialized skills that can be invoked with `/hawat-<skill>`:

#### Core Skills (Phase 4)

| Skill | Context | Purpose |
|-------|---------|---------|
| `hawat-orchestrate` | main | Main workflow coordination and task management |
| `hawat-explore` | **forked** | Isolated codebase exploration (doesn't pollute context) |
| `hawat-validate` | main | Pre-completion quality gates and verification |

#### Extended Skills (Phase 5)

| Skill | Context | Purpose |
|-------|---------|---------|
| `hawat-lsp` | **forked** | Semantic code operations (go-to-definition, find references) |
| `hawat-refactor` | **forked** | AST-grep structural code transformations |
| `hawat-checkpoint` | main | Session state checkpointing and recovery |
| `hawat-tdd` | **forked** | Test-driven development workflow |
| `hawat-incremental-refactor` | **forked** | Per-file refactoring with verification |
| `hawat-doc-sync` | main | Documentation synchronization with code |

### Forked Context (Key Feature)

The `hawat-explore` skill uses **forked context**, a Claude Code 2.1 feature:

```yaml
---
name: hawat-explore
context: fork                    # Isolated context
---
```

**Benefits:**
- Exploration doesn't consume main session context
- Can read 50+ files without context bloat
- Only summarized results return to main session
- Perfect for research and discovery tasks

### Using Skills

**Invoke a skill:**
```
/hawat-explore Find all API endpoints and their handlers
```

**Skill-specific hooks fire automatically:**
- PreToolUse: Validate commands before execution
- Stop: Cleanup and notification when skill completes

### Skill Frontmatter Hooks

Skills can define hooks directly in their frontmatter (Claude Code 2.1):

```yaml
---
name: my-skill
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: "echo 'Validating...'"
  PostToolUse:
    - matcher: Edit|Write
      hooks:
        - type: command
          command: "npm run lint $FILE"
  Stop:
    - type: command
      command: "echo 'Skill complete'"
---
```

**Available Hook Events:**
| Event | Trigger | Use Case |
|-------|---------|----------|
| `PreToolUse` | Before tool execution | Validation, safety checks |
| `PostToolUse` | After tool execution | Formatting, linting, logging |
| `Stop` | Skill completion | Cleanup, notifications |

---

## Permission Patterns (Claude Code 2.1 Wildcards)

### Wildcard Syntax

Claude Code 2.1 supports flexible wildcard permissions:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm *)",           // All npm commands
      "Bash(git *)",           // All git commands
      "Bash(*--help)",         // Any help command
      "Bash(*--version)",      // Any version check
      "Bash(*-h)"              // Short help flags
    ],
    "deny": [
      "Bash(rm -rf *)",        // Block recursive delete
      "Bash(sudo *)",          // Block privilege escalation
      "Bash(curl * | sh)"      // Block pipe to shell
    ]
  }
}
```

### Pattern Examples

| Pattern | Matches | Examples |
|---------|---------|----------|
| `Bash(npm *)` | Any npm command | `npm install`, `npm test`, `npm run build` |
| `Bash(git *)` | Any git command | `git status`, `git commit -m "..."` |
| `Bash(*--help)` | Help flags | `node --help`, `npm --help` |
| `Bash(*-v)` | Version flags | `node -v`, `python -v` |

### Deny Patterns (Security)

These patterns are always blocked for safety:

| Pattern | Reason |
|---------|--------|
| `Bash(rm -rf /)` | Prevents root deletion |
| `Bash(sudo *)` | Prevents privilege escalation |
| `Bash(curl * \| sh)` | Prevents remote code execution |
| `Bash(eval *)` | Prevents arbitrary code execution |
| `Read(**/.env*)` | Protects secrets |
| `Write(**/.ssh/**)` | Protects SSH keys |

### Project-Type Specific

Your project type ({{projectType}}) has these allowed patterns:

{{#if-eq projectType "node"}}
```
Bash(npm *)     - Package management
Bash(npx *)     - Package execution
Bash(node *)    - Node runtime
Bash(yarn *)    - Yarn package manager
Bash(pnpm *)    - PNPM package manager
Bash(jest *)    - Jest testing
Bash(eslint *)  - Linting
Bash(prettier *)- Formatting
Bash(tsc *)     - TypeScript compiler
```
{{else}}
{{#if-eq projectType "python"}}
```
Bash(python *)  - Python runtime
Bash(pip *)     - Package management
Bash(pytest *)  - Testing
Bash(poetry *)  - Poetry package manager
Bash(uv *)      - UV package manager
Bash(black *)   - Formatting
Bash(ruff *)    - Linting
Bash(mypy *)    - Type checking
```
{{else}}
{{#if-eq projectType "go"}}
```
Bash(go *)      - Go toolchain
Bash(make *)    - Makefile execution
Bash(gofmt *)   - Formatting
Bash(golint *)  - Linting
```
{{else}}
{{#if-eq projectType "rust"}}
```
Bash(cargo *)   - Cargo package manager
Bash(rustc *)   - Rust compiler
Bash(rustfmt *) - Formatting
Bash(clippy *)  - Linting
Bash(rustup *)  - Toolchain management
```
{{else}}
```
Bash(make *)    - Makefile execution
```
{{/if-eq}}
{{/if-eq}}
{{/if-eq}}
{{/if-eq}}


## lsp operations

## LSP Operations

Hawat supports semantic code operations through LSP (Language Server Protocol).
These provide accurate, language-aware navigation and refactoring.

### Available Operations

| Operation | Description | Fallback |
|-----------|-------------|----------|
| **Go to Definition** | Jump to symbol definition | Grep search |
| **Find References** | All usages of a symbol | Grep search |
| **Get Diagnostics** | Errors and warnings | Compiler output |
| **Hover Info** | Documentation and types | Doc comments |
| **Rename Symbol** | Safe cross-project rename | ast-grep or sed |

### MCP Language Server Integration

If `mcp-language-server` is configured, semantic operations are automatic:

```json
{
  "mcpServers": {
    "language-server": {
      "command": "mcp-language-server",
      "args": ["--workspace", "/path/to/project", "--lsp", "gopls"]
    }
  }
}
```

**Supported Language Servers:**
- **Go**: gopls
- **Rust**: rust-analyzer
- **Python**: pyright
- **TypeScript/JavaScript**: typescript-language-server
- **C/C++**: clangd

### CLI Fallbacks

When LSP MCP is not available, use CLI tools:

{{#if-eq projectType "node"}}
```bash
# TypeScript/JavaScript
npx tsc --noEmit                    # Diagnostics
grep -rn "function NAME" src/        # Find definition
grep -rn "symbolName" src/           # Find references
```
{{else}}
{{#if-eq projectType "typescript"}}
```bash
# TypeScript
npx tsc --noEmit                    # Diagnostics
grep -rn "function NAME" src/        # Find definition
grep -rn "symbolName" src/           # Find references
```
{{else}}
{{#if-eq projectType "python"}}
```bash
# Python
pyright . --outputjson              # Diagnostics
grep -rn "def NAME\|class NAME" .   # Find definition
grep -rn "symbolName" .             # Find references
python -m pydoc module.Symbol       # Documentation
```
{{else}}
{{#if-eq projectType "go"}}
```bash
# Go
go vet ./...                        # Diagnostics
go doc package.Symbol               # Documentation
grep -rn "func NAME" .              # Find definition
grep -rn "symbolName" .             # Find references
```
{{else}}
{{#if-eq projectType "rust"}}
```bash
# Rust
cargo check                         # Diagnostics
cargo doc --open                    # Documentation
grep -rn "fn NAME\|struct NAME" src/ # Find definition
grep -rn "symbolName" src/          # Find references
```
{{else}}
```bash
# Generic fallback
grep -rn "function\|def\|func NAME" . # Find definition
grep -rn "symbolName" .               # Find references
```
{{/if-eq}}
{{/if-eq}}
{{/if-eq}}
{{/if-eq}}
{{/if-eq}}

### Using the hawat-lsp Skill

For complex semantic operations, invoke the LSP skill:

```
/hawat-lsp

Find all references to the UserService class
```

The skill will:
1. Try LSP MCP first (if configured)
2. Fall back to language-specific CLI tools
3. Use grep-based search as last resort

### Rename Safety

For safe cross-project renames, prefer this order:

1. **LSP rename** (most accurate)
2. **ast-grep** (AST-aware, safe)
3. **sed/grep** (text-based, requires review)

```bash
# Safe rename with ast-grep
ast-grep --pattern 'oldName' --rewrite 'newName' --lang typescript src/
```


## ast grep patterns

## AST-grep Patterns

[ast-grep](https://ast-grep.github.io/) provides safe, structural code transformations.
Unlike text-based find/replace, it understands code syntax.

### Installation

```bash
# macOS
brew install ast-grep

# npm
npm install -g @ast-grep/cli

# cargo
cargo install ast-grep
```

### Basic Usage

```bash
# Search for pattern
ast-grep --pattern 'PATTERN' --lang LANG PATH

# Replace pattern
ast-grep --pattern 'PATTERN' --rewrite 'NEW' --lang LANG PATH

# Interactive mode (review each change)
ast-grep --pattern 'PATTERN' --rewrite 'NEW' --interactive --lang LANG PATH
```

### Pattern Variables

| Variable | Matches | Example |
|----------|---------|---------|
| `$NAME` | Single AST node | `function $NAME()` |
| `$$$ARGS` | Multiple nodes | `console.log($$$ARGS)` |
| `$_` | Anonymous node | `if ($_) { }` |

### Common Patterns

{{#if-eq projectType "node"}}
#### JavaScript/TypeScript Patterns

```bash
# Convert function to arrow function
ast-grep --pattern 'function $NAME($$$ARGS) { return $EXPR }' \
         --rewrite 'const $NAME = ($$$ARGS) => $EXPR' \
         --lang javascript src/

# Remove console.log
ast-grep --pattern 'console.log($$$ARGS)' \
         --rewrite '' \
         --lang javascript src/

# Convert require to import
ast-grep --pattern 'const $NAME = require($PATH)' \
         --rewrite 'import $NAME from $PATH' \
         --lang javascript src/

# Add await to async call
ast-grep --pattern '$FN($$$ARGS).then($$$HANDLERS)' \
         --rewrite 'await $FN($$$ARGS)' \
         --lang javascript src/
```
{{else}}
{{#if-eq projectType "typescript"}}
#### TypeScript Patterns

```bash
# Convert function to arrow
ast-grep --pattern 'function $NAME($$$ARGS): $RET { return $EXPR }' \
         --rewrite 'const $NAME = ($$$ARGS): $RET => $EXPR' \
         --lang typescript src/

# Add explicit return type
ast-grep --pattern 'function $NAME($$$ARGS) {' \
         --rewrite 'function $NAME($$$ARGS): void {' \
         --lang typescript src/

# Convert any to unknown
ast-grep --pattern ': any' \
         --rewrite ': unknown' \
         --lang typescript src/
```
{{else}}
{{#if-eq projectType "python"}}
#### Python Patterns

```bash
# Convert print to logging
ast-grep --pattern 'print($$$ARGS)' \
         --rewrite 'logger.info($$$ARGS)' \
         --lang python .

# Add type hints
ast-grep --pattern 'def $NAME($ARG):' \
         --rewrite 'def $NAME($ARG: Any) -> None:' \
         --lang python .

# Convert string format to f-string
ast-grep --pattern '"$STR".format($$$ARGS)' \
         --rewrite 'f"$STR"' \
         --lang python .
```
{{else}}
{{#if-eq projectType "go"}}
#### Go Patterns

```bash
# Add error checking
ast-grep --pattern '$VAR, _ := $CALL' \
         --rewrite '$VAR, err := $CALL; if err != nil { return err }' \
         --lang go .

# Convert fmt.Println to log
ast-grep --pattern 'fmt.Println($$$ARGS)' \
         --rewrite 'log.Println($$$ARGS)' \
         --lang go .
```
{{else}}
{{#if-eq projectType "rust"}}
#### Rust Patterns

```bash
# Convert unwrap to expect
ast-grep --pattern '$EXPR.unwrap()' \
         --rewrite '$EXPR.expect("TODO: handle error")' \
         --lang rust src/

# Add derive macro
ast-grep --pattern 'struct $NAME {' \
         --rewrite '#[derive(Debug, Clone)]\nstruct $NAME {' \
         --lang rust src/
```
{{else}}
#### Generic Patterns

```bash
# JavaScript - Remove debug statements
ast-grep --pattern 'console.log($$$)' --rewrite '' --lang javascript src/

# Python - Convert prints to logs
ast-grep --pattern 'print($$$)' --rewrite 'logging.info($$$)' --lang python .
```
{{/if-eq}}
{{/if-eq}}
{{/if-eq}}
{{/if-eq}}
{{/if-eq}}

### Safety Protocol

1. **Preview first** - Run without `--rewrite` to see matches
2. **Use interactive** - Review each change with `--interactive`
3. **Git backup** - Stash or commit before bulk changes
4. **Test after** - Run test suite after transformations

### When to Use ast-grep vs. Edit Tool

| Scenario | Use ast-grep | Use Edit |
|----------|--------------|----------|
| Same pattern across many files | ✅ | ❌ |
| Structural code transformation | ✅ | ❌ |
| One-off specific edit | ❌ | ✅ |
| Complex logic changes | ❌ | ✅ |
| ast-grep not installed | ❌ | ✅ |


## checkpoint system

## Checkpoint System

Checkpoints preserve session state for recovery and continuity.
Use them before risky operations and at regular intervals.

### Checkpoint Triggers

Create checkpoints at:

| Trigger | When | Why |
|---------|------|-----|
| **Time** | Every 30 minutes | Regular state preservation |
| **Milestone** | After phase completion | Mark progress points |
| **Risk** | Before refactoring | Enable rollback |
| **Request** | User asks to save | Explicit preservation |

### Checkpoint Location

```
.claude/
├── checkpoint.md           # Current session checkpoint
├── critical-context.md     # Survives context compaction
└── context.md              # Session context
```

### Checkpoint Contents

A checkpoint captures:

1. **Objective** - What we're trying to accomplish
2. **Git State** - Current branch and status
3. **Todo State** - Active, completed, pending todos
4. **Files in Progress** - What's being modified
5. **Critical Decisions** - Important choices made
6. **Next Steps** - Where to resume

### Using the Checkpoint Skill

To create a checkpoint:
```
/hawat-checkpoint
```

To recover from a checkpoint:
```
Read .claude/checkpoint.md and resume from the documented state.
```

### Checkpoint Template

```markdown
# Session Checkpoint

**Created**: 2026-01-08T12:34:56Z
**Branch**: feature/new-feature
**Objective**: Implement user authentication

## Git Status
M src/auth.ts
M src/middleware.ts
?? src/auth.test.ts

## Active Todos
| Status | Task |
|--------|------|
| ✅ | Set up auth middleware |
| 🔄 | Implement login endpoint |
| ⏳ | Add logout functionality |
| ⏳ | Write tests |

## Files in Progress
- `src/auth.ts`: Implementing JWT validation
- `src/middleware.ts`: Adding auth middleware to routes

## Critical Decisions
1. Using JWT over sessions for stateless auth
2. Token expiry set to 24 hours
3. Refresh tokens stored in httpOnly cookies

## Recovery Instructions
1. Check git status for uncommitted changes
2. Resume implementing login endpoint
3. JWT signing key is in .env (don't commit)

## Next Steps
- [ ] Complete login endpoint implementation
- [ ] Add error handling for invalid credentials
- [ ] Write integration tests
```

### Recovery Workflow

When resuming from a checkpoint:

```
1. Read checkpoint file
2. Verify git state matches
3. Review any uncommitted changes
4. Restore todo state
5. Continue from "Next Steps"
```

### Automatic Checkpoints

Hooks can create automatic checkpoints:

```json
{
  "hooks": {
    "PreCompact": [
      {"type": "command", "command": "cat .claude/critical-context.md"}
    ]
  }
}
```

### Best Practices

- **Checkpoint before refactoring** - Easy rollback if things break
- **Include rationale** - Future you needs context
- **Keep it current** - Stale checkpoints are useless
- **Don't over-checkpoint** - Every 30 min is usually enough


## skill composition

## Skill Composition Patterns

Hawat skills can be composed (chained) to accomplish complex workflows.
Understanding when and how to chain skills is key to effective orchestration.

### Composition Strategies

#### Sequential Chaining

Run skills one after another, passing context forward:

```
hawat-explore → gather context
       ↓
hawat-refactor → apply changes
       ↓
hawat-validate → verify results
```

**When to use**: Multi-phase workflows where each phase depends on the previous.

#### Parallel Execution

Run multiple forked skills simultaneously:

```
┌─ hawat-explore (parallel mode) (search 1)
│
├─ hawat-explore (parallel mode) (search 2)
│
└─ hawat-explore (parallel mode) (search 3)
         ↓
    Consolidate results in main context
```

**When to use**: Independent explorations that can run concurrently.

#### Nested Delegation

A skill invokes another skill for sub-tasks:

```
hawat-incremental-refactor
    │
    ├─ (for each file)
    │     ├─ Apply change
    │     └─ hawat-tdd → verify with tests
    │
    └─ hawat-validate → final verification
```

**When to use**: Complex operations with embedded verification steps.

### Common Composition Patterns

#### Pattern 1: Explore-Plan-Execute

```
1. hawat-explore (forked)
   → Understand codebase structure
   → Return summary to main

2. Plan changes in main context
   → Use exploration results
   → Define scope

3. hawat-incremental-refactor (forked)
   → Apply planned changes
   → Verify each step
```

#### Pattern 2: TDD Feature Development

```
1. hawat-explore (forked)
   → Find existing patterns
   → Identify test locations

2. hawat-tdd (forked)
   → Write failing test
   → Implement feature
   → Verify green

3. hawat-doc-sync (main)
   → Update documentation
   → Sync README
```

#### Pattern 3: Safe Refactoring

```
1. hawat-checkpoint (main)
   → Save current state
   → Create recovery point

2. hawat-refactor (forked)
   → Apply ast-grep patterns
   → Structural changes

3. hawat-validate (main)
   → Verify all checks pass
   → If fail, restore from checkpoint
```

#### Pattern 4: Multi-Angle Investigation

```
1. hawat-explore (parallel mode) (forked) × 3
   → Angle 1: Search for patterns
   → Angle 2: Check dependencies
   → Angle 3: Review tests

2. Consolidate in main context
   → Merge findings
   → Identify gaps

3. hawat-lsp (forked)
   → Semantic analysis
   → Find references
```

### Skill Context Flow

Understanding how context flows between skills:

| Source Context | Skill Context | Return to Main |
|----------------|---------------|----------------|
| Main session | **fork** | Summary only |
| Main session | **main** | Full context preserved |
| Forked skill | **fork** (nested) | Summary to parent fork |

### Best Practices

1. **Start with exploration** - Understand before changing
2. **Checkpoint before risk** - Save state before complex operations
3. **Verify incrementally** - Don't batch too many changes
4. **Gate before done** - Always run quality gate last
5. **Keep summaries concise** - Forked context returns should be focused

### Anti-Patterns to Avoid

| Anti-Pattern | Problem | Better Approach |
|--------------|---------|-----------------|
| Skip exploration | Changes break unknown dependencies | Explore first |
| No checkpoint | Can't recover from failures | Checkpoint before refactor |
| Batch everything | Hard to find which change broke things | Incremental changes |
| Skip quality gate | Ship broken code | Always gate before done |
| Too many nested forks | Context confusion | Max 2 levels of nesting |

### Composition Decision Tree

```
Is this a simple, single-file change?
├─ Yes → Direct edit, no skills needed
└─ No ↓

Do I need to understand the codebase first?
├─ Yes → hawat-explore or hawat-explore (parallel mode)
└─ No ↓

Am I making risky changes?
├─ Yes → hawat-checkpoint first
└─ No ↓

Am I changing structure across files?
├─ Yes → hawat-refactor or hawat-incremental-refactor
└─ No ↓

Am I adding new functionality?
├─ Yes → hawat-tdd
└─ No ↓

Am I done with changes?
├─ Yes → hawat-validate
└─ No → Continue working
```

