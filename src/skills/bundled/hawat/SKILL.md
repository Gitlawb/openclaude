# Hawat Skill

## Skill Identity

**Name**: hawat
**Type**: Orchestration Framework
**Version**: 1.0.0

## Purpose

Hawat is an orchestration skill that enables OmO-style systematic workflows,
intelligent agent delegation, and robust error recovery for Claude Code.

## Invocation

This skill is automatically active when a project contains Hawat configuration
(CLAUDE.md with Hawat markers).

## Core Behaviors

### 1. Task Management

When working on multi-step tasks:

- Always use TodoWrite for 3+ step tasks
- Track progress continuously
- Never leave incomplete todos
- Mark complete only when verified

### 2. Error Recovery

After 3 consecutive failures:

1. STOP - Halt modifications
2. REVERT - Return to working state
3. DOCUMENT - Record failure details
4. CONSULT - Get architectural guidance
5. ESCALATE - Ask user if still stuck

### 3. Agent Delegation

Use specialized agents appropriately:

| Agent | Model | Use For |
|-------|-------|---------|
| Explore | sonnet | File searches, structure analysis |
| general-purpose | sonnet | Research, documentation |
| Plan | opus | Architecture, complex design |
| security-engineer | opus | Security review |
| performance-engineer | opus | Optimization |
| frontend-architect | opus | UI/UX work |
| backend-architect | opus | API design |

### 4. Workflow Phases

Follow the phase-based workflow:

- **Phase 0**: Classify intent (Trivial/Explicit/Exploratory/Open-ended)
- **Phase 1**: Assess codebase for complex tasks
- **Phase 2A**: Explore and research
- **Phase 2B**: Implement with tracking
- **Phase 2C**: Recover from failures
- **Phase 3**: Verify and complete

### 5. Context Preservation

Maintain context across sessions:

- Read CLAUDE.md at session start
- Update checkpoint.md for long tasks
- Use critical-context.md for compaction survival
- Document decisions in context.md

## Quality Standards

- Match existing code style exactly
- No TODO comments in core functionality
- No placeholder implementations
- Run quality checks after edits
- Preserve existing tests

## Commands

The Hawat CLI provides project management:

```bash
hawat install    # Install global components
hawat init       # Initialize in project
hawat update     # Update components
hawat doctor     # Health check
```

## Integration

Hawat integrates with Claude Code through:

1. **CLAUDE.md** - Project orchestration rules
2. **settings.json** - Hooks and permissions
3. **context.md** - Session context
4. **checkpoint.md** - Task state preservation

## Philosophy

Hawat is inspired by the OmO (OpenCode Multi-agent Orchestration) framework,
adapted specifically for Claude Code's capabilities. The goal is to provide
systematic, reliable, and high-quality AI-assisted development.

---

*"The spice must flow" - Hawat orchestrates the flow of development*
