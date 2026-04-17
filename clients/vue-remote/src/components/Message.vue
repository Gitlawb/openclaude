<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RenderedMessage } from '../composables/renderMessage'
import { formatDurationUk, t } from '../i18n'

defineProps<{
  message: RenderedMessage
}>()

// All blocks expanded by default (like the TUI). Track collapsed ones.
const collapsed = ref<Record<number, boolean>>({})

function isExpanded(idx: number): boolean {
  return !collapsed.value[idx]
}

function toggle(idx: number) {
  collapsed.value[idx] = !collapsed.value[idx]
}

function resultPreview(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return t.messages.empty
  const line = trimmed.split('\n')[0] ?? ''
  return line.length > 80 ? line.slice(0, 80) + '…' : line
}

function durationLabel(ms: number): string {
  return `✻ ${t.turn.prefix} ${formatDurationUk(ms)}`
}

function splitLines(text: string): string[] {
  // Cap at a reasonable number to keep the DOM small; the raw content
  // stays available inside the JSON body for pathological cases.
  return text.split('\n').slice(0, 400)
}

const computedHasStatusClass = computed(() => (status: string) => {
  return `todo-${status.replace(/[^a-z_]/gi, '').toLowerCase()}`
})
</script>

<template>
  <div class="msg" :class="message.role">
    <div
      v-for="(block, idx) in message.blocks"
      :key="idx"
      class="block"
      :class="`block-${block.kind}`"
    >
      <template v-if="block.kind === 'text'">
        <div class="text">{{ block.text }}</div>
      </template>

      <template v-else-if="block.kind === 'local_output'">
        <pre class="code local-output">{{ block.text }}</pre>
      </template>

      <template v-else-if="block.kind === 'tool_use'">
        <button
          class="tool-header"
          type="button"
          :title="block.summary.name"
          @click="toggle(idx)"
        >
          <span class="caret" :class="{ open: isExpanded(idx) }">▸</span>
          <span class="tool-icon">●</span>
          <span class="tool-label">{{ block.summary.label }}</span>
        </button>

        <div v-if="isExpanded(idx)" class="tool-body-wrap">
          <!-- Edit / MultiEdit: diff view -->
          <div v-if="block.summary.body.kind === 'diff'" class="diff">
            <div
              v-for="(ln, i) in splitLines(block.summary.body.removed)"
              :key="'r' + i"
              class="diff-line removed"
            >
              <span class="diff-marker">-</span>
              <span class="diff-text">{{ ln }}</span>
            </div>
            <div
              v-for="(ln, i) in splitLines(block.summary.body.added)"
              :key="'a' + i"
              class="diff-line added"
            >
              <span class="diff-marker">+</span>
              <span class="diff-text">{{ ln }}</span>
            </div>
          </div>

          <!-- Write: full content preview -->
          <div v-else-if="block.summary.body.kind === 'write'" class="write">
            <div class="file-meta">{{ block.summary.body.path }}</div>
            <pre class="code">{{ block.summary.body.content }}</pre>
          </div>

          <!-- Bash / PowerShell: command block -->
          <div v-else-if="block.summary.body.kind === 'command'" class="command">
            <div v-if="block.summary.body.description" class="command-desc">
              {{ block.summary.body.description }}
            </div>
            <pre class="code shell">$ {{ block.summary.body.command }}</pre>
          </div>

          <!-- Read / file path reference -->
          <div v-else-if="block.summary.body.kind === 'path'" class="path">
            <div class="file-meta">
              <code>{{ block.summary.body.path }}</code>
              <span v-if="block.summary.body.detail" class="file-detail">
                · {{ block.summary.body.detail }}
              </span>
            </div>
          </div>

          <!-- TodoWrite -->
          <ul
            v-else-if="block.summary.body.kind === 'todos'"
            class="todos"
          >
            <li
              v-for="(todo, i) in block.summary.body.todos"
              :key="i"
              :class="computedHasStatusClass(todo.status)"
            >
              <span class="todo-marker">{{
                todo.status === 'completed'
                  ? '✔'
                  : todo.status === 'in_progress'
                    ? '→'
                    : '·'
              }}</span>
              <span class="todo-text">{{ todo.content }}</span>
            </li>
          </ul>

          <!-- Plain text -->
          <pre
            v-else-if="block.summary.body.kind === 'text'"
            class="code"
          >{{ block.summary.body.text }}</pre>

          <!-- Generic JSON fallback -->
          <pre
            v-else-if="block.summary.body.kind === 'json'"
            class="code json"
          >{{ block.summary.body.text }}</pre>
        </div>
      </template>

      <template v-else-if="block.kind === 'tool_result'">
        <button
          class="tool-header result"
          :class="{ error: block.isError }"
          type="button"
          @click="toggle(idx)"
        >
          <span class="caret" :class="{ open: isExpanded(idx) }">▸</span>
          <span class="tool-icon">{{ block.isError ? '✖' : '⎿' }}</span>
          <span class="tool-label preview">{{ resultPreview(block.content) }}</span>
        </button>
        <pre v-if="isExpanded(idx)" class="code result-body" :class="{ error: block.isError }">{{ block.content }}</pre>
      </template>

      <template v-else-if="block.kind === 'image'">
        <img
          v-if="block.data && block.mediaType"
          class="image"
          :src="`data:${block.mediaType};base64,${block.data}`"
          alt="attached image"
        />
        <div v-else class="text muted">{{ t.messages.image }}</div>
      </template>

      <template v-else-if="block.kind === 'turn_duration'">
        <div class="turn-duration">{{ durationLabel(block.durationMs) }}</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Line-based layout — no bubbles. Role is expressed with a coloured prefix
   (like Ink's "> " for the human and an unprefixed line for the model). */
.msg {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 0 2px 16px;
  /* min-width:0 is critical for flex children: without it the item refuses
     to shrink below its content width, causing horizontal overflow */
  min-width: 0;
  width: 100%;
  max-width: 100%;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  font-size: var(--font-size-base);
  line-height: var(--line-height);
  position: relative;
}

/* User prompt lines are rendered like `> hello` in amber. */
.msg.user {
  color: var(--user);
  padding-left: 20px;
}
.msg.user::before {
  content: ">";
  position: absolute;
  left: 4px;
  top: 2px;
  color: var(--user);
  font-weight: 700;
  user-select: none;
}

/* Assistant lines are plain text, subtle left gutter for visual grouping. */
.msg.assistant {
  color: var(--fg);
  padding-left: 16px;
}

/* System lines are dim and inline; turn-duration uses the dedicated rule below. */
.msg.system {
  color: var(--fg-muted);
  font-size: var(--font-size-sm);
  padding-left: 16px;
}

.text {
  white-space: pre-wrap;
}
.text.muted {
  color: var(--fg-muted);
}

/* ─── Tool call / result header ─────────────────────────────── */

.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: transparent;
  border: none;
  padding: 4px 8px;
  color: var(--fg);
  font: inherit;
  font-size: var(--font-size-base);
  cursor: pointer;
  border-radius: var(--radius-sm);
  text-align: left;
  transition: background 0.12s;
  min-width: 0;
}
.tool-header:hover {
  background: var(--bg-chip);
}
.tool-header.result {
  color: var(--fg-muted);
  padding-left: 18px;
  font-size: var(--font-size-sm);
}
.tool-header.result.error {
  color: var(--danger);
}

.caret {
  display: inline-block;
  transition: transform 0.15s;
  font-size: 10px;
  color: var(--fg-muted);
  flex-shrink: 0;
}
.caret.open {
  transform: rotate(90deg);
}

.tool-icon {
  color: var(--accent);
  font-size: 11px;
  flex-shrink: 0;
}
.tool-header.result .tool-icon {
  color: var(--fg-muted);
}
.tool-header.result.error .tool-icon {
  color: var(--danger);
}

.tool-label {
  font-size: var(--font-size-base);
  font-weight: 500;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-label.preview {
  font-weight: 400;
  font-size: var(--font-size-sm);
}

.tool-body-wrap {
  margin: 2px 0 2px 22px;
  max-width: calc(100% - 22px);
  min-width: 0;
}

/* ─── Diff ─────────────────────────────────────────────────── */

.diff {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 4px 0;
  max-height: 400px;
  overflow: auto;
  font-size: var(--font-size-sm);
  line-height: 1.45;
  min-width: 0;
  max-width: 100%;
}
.diff-line {
  display: flex;
  padding: 0 10px;
  white-space: pre;
}
.diff-line.removed {
  background: rgba(122, 41, 54, 0.35); /* diffRemoved rgb(122,41,54) */
  color: #b3596b;                       /* diffRemovedWord rgb(179,89,107) */
}
.diff-line.added {
  background: rgba(34, 92, 43, 0.35);  /* diffAdded rgb(34,92,43) */
  color: #38a660;                       /* diffAddedWord rgb(56,166,96) */
}
.diff-marker {
  width: 18px;
  text-align: center;
  opacity: 0.6;
  user-select: none;
}
.diff-text {
  flex: 1;
  word-wrap: break-word;
  white-space: pre-wrap;
}

/* ─── Write / code block ───────────────────────────────────── */

.write .file-meta,
.path .file-meta {
  color: var(--fg-muted);
  font-size: var(--font-size-sm);
  margin-bottom: 2px;
}
.write .file-meta code,
.path .file-meta code {
  background: transparent;
  color: var(--accent);
}
.path .file-detail {
  opacity: 0.7;
  margin-left: 2px;
}

.code {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--fg);
  max-height: 320px;
  /* Scroll horizontally inside the block; never push the layout wider */
  overflow-x: auto;
  overflow-y: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  line-height: 1.45;
  /* Ensure block never exceeds its container */
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.code.shell {
  color: var(--success);
}
.code.json {
  color: var(--fg);
}

.local-output {
  color: var(--fg-muted);
  border-color: var(--border);
}

.code.result-body {
  margin-top: 2px;
  margin-left: 22px;
  max-width: calc(100% - 22px);
}
.code.result-body.error {
  border-color: rgba(255, 107, 128, 0.4); /* error rgb(255,107,128) */
  color: var(--danger);
}

.command-desc {
  color: var(--fg-muted);
  font-size: var(--font-size-sm);
  margin-bottom: 2px;
}

/* ─── Todo list ────────────────────────────────────────────── */

.todos {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.todos li {
  display: flex;
  gap: 8px;
  font-size: var(--font-size-base);
  padding: 2px 4px;
  border-radius: 0;
}
.todos .todo-marker {
  color: var(--fg-muted);
  width: 14px;
  text-align: center;
}
.todo-completed {
  color: var(--success);
  text-decoration: line-through;
  opacity: 0.7;
}
.todo-completed .todo-marker {
  color: var(--success);
}
.todo-in_progress {
  color: var(--accent);
}
.todo-in_progress .todo-marker {
  color: var(--accent);
}

/* ─── Image ────────────────────────────────────────────────── */

.image {
  max-width: 100%;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}

/* ─── Turn duration line ───────────────────────────────────── */

.turn-duration {
  color: var(--fg-dim);
  font-size: var(--font-size-sm);
  letter-spacing: 0.2px;
  padding: 4px 0;
}
</style>
