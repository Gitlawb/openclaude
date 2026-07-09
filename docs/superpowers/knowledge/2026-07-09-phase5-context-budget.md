# 2026-07-09 — Phase 5 context budget

**Ação:** Ativar masking de tool results no open build quando autonomy está ON.

**Mecanismo (já existia, desligado via GrowthBook):**
- `provisionContentReplacementState` agora também liga com autonomy
- Caps mais baixos: 20k/tool, 80k/mensagem (vs 50k/200k default)
- Full output em disco; modelo recebe preview + path

**File Read:** dedup `file_unchanged` já existia (mtime + range).

**Disable:** `OPENCLAUDE_MASK_TOOL_RESULTS=0` ou `autonomy.maskToolResults: false`
