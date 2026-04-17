<script setup lang="ts">
import { computed, reactive } from 'vue'
import { t } from '../i18n'
import type { RemotePermissionRequest } from '../types'

const props = defineProps<{
  request: RemotePermissionRequest
}>()

const emit = defineEmits<{
  allow: [requestId: string, message?: string]
  deny: [requestId: string]
}>()

// ─── AskUserQuestion detection ──────────────────────────────────────────────

type QuestionOption = { label: string; description?: string }
type Question = { question: string; header?: string; options: QuestionOption[]; multiSelect?: boolean }

const askQuestions = computed<Question[] | null>(() => {
  if (props.request.toolName !== 'AskUserQuestion') return null
  const inp = props.request.input as { questions?: Question[] } | null
  if (!inp?.questions?.length) return null
  return inp.questions
})

// answers: question text → selected label(s)
const answers = reactive<Record<string, string | string[]>>({})

function isSelected(question: Question, label: string): boolean {
  if (question.multiSelect) {
    const cur = answers[question.question]
    return Array.isArray(cur) ? cur.includes(label) : false
  }
  return answers[question.question] === label
}

function toggleOption(question: Question, label: string) {
  if (question.multiSelect) {
    const cur = (answers[question.question] as string[] | undefined) ?? []
    const idx = cur.indexOf(label)
    answers[question.question] = idx >= 0 ? cur.filter(l => l !== label) : [...cur, label]
  } else {
    answers[question.question] = label
  }
}

const allAnswered = computed(() => {
  const qs = askQuestions.value
  if (!qs) return false
  return qs.every(q => {
    const a = answers[q.question]
    return Array.isArray(a) ? a.length > 0 : !!a
  })
})

function submitAnswers() {
  const qs = askQuestions.value
  if (!qs) return
  const flat: Record<string, string> = {}
  for (const q of qs) {
    const a = answers[q.question]
    flat[q.question] = Array.isArray(a) ? a.join(', ') : (a ?? '')
  }
  emit('allow', props.request.requestId, JSON.stringify({ answers: flat }))
}

// ─── Generic permission (non-AskUserQuestion) ────────────────────────────────

const inputText = computed(() => {
  if (askQuestions.value) return ''
  const v = props.request.input
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
})
</script>

<template>
  <!-- ── AskUserQuestion: interactive multi-choice UI ─────────────────────── -->
  <div v-if="askQuestions" class="banner ask" role="dialog">
    <div class="header">
      <span class="tool">{{ request.toolName }}</span>
    </div>

    <div v-for="q in askQuestions" :key="q.question" class="question-block">
      <div class="question-text">{{ q.question }}</div>
      <div class="options">
        <button
          v-for="opt in q.options"
          :key="opt.label"
          type="button"
          class="option"
          :class="{ selected: isSelected(q, opt.label) }"
          @click="toggleOption(q, opt.label)"
        >
          <span class="option-marker">{{ isSelected(q, opt.label) ? (q.multiSelect ? '☑' : '◉') : (q.multiSelect ? '☐' : '○') }}</span>
          <span class="option-content">
            <span class="option-label">{{ opt.label }}</span>
            <span v-if="opt.description" class="option-desc">{{ opt.description }}</span>
          </span>
        </button>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="deny" @click="emit('deny', request.requestId)">
        {{ t.permission.deny }}
      </button>
      <button
        type="button"
        class="allow"
        :disabled="!allAnswered"
        @click="submitAnswers"
      >
        {{ t.permission.allow }}
      </button>
    </div>
  </div>

  <!-- ── Generic permission banner ─────────────────────────────────────────── -->
  <div v-else class="banner" role="alertdialog">
    <div class="header">
      <span class="badge">{{ t.permission.badge }}</span>
      <span class="tool">{{ request.toolName }}</span>
    </div>
    <div v-if="request.description" class="description">
      {{ request.description }}
    </div>
    <pre v-if="inputText" class="input">{{ inputText }}</pre>
    <div class="actions">
      <button
        type="button"
        class="deny"
        @click="emit('deny', request.requestId)"
      >
        {{ t.permission.deny }}
      </button>
      <button
        type="button"
        class="allow"
        @click="emit('allow', request.requestId)"
      >
        {{ t.permission.allow }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.banner {
  margin: 8px 10px 0 10px;
  margin-left: max(10px, env(safe-area-inset-left));
  margin-right: max(10px, env(safe-area-inset-right));
  padding: 12px 14px 14px 14px;
  border-radius: var(--radius);
  background: var(--bg-elev);
  border: 1px solid var(--warning);
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  animation: slide-in 0.2s ease-out;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  box-shadow: var(--shadow-md);
  word-wrap: break-word;
  overflow-wrap: anywhere;
}

/* TUI-style title tag on the top border */
.banner::before {
  content: "[ permission ]";
  position: absolute;
  top: -0.7em;
  left: 10px;
  padding: 0 6px;
  background: var(--bg);
  color: var(--warning);
  font-size: var(--font-size-sm);
  letter-spacing: 0.5px;
}

.banner.ask::before {
  content: "[ ? ]";
  color: var(--accent-dim);
}

.banner.ask {
  border-color: var(--accent-dim);
}

@keyframes slide-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--warning);
  font-size: var(--font-size-base);
}

.badge {
  display: none; /* the ::before box-title already serves this role */
}

.tool {
  font-weight: 600;
  font-size: var(--font-size-base);
  color: var(--fg);
}
.tool::before {
  content: "⚡ ";
  color: var(--warning);
}
.banner.ask .tool::before {
  content: "";
}

.description {
  color: var(--fg-muted);
  font-size: var(--font-size-sm);
  line-height: 1.45;
  padding-left: 14px;
  position: relative;
}
.description::before {
  content: "│";
  position: absolute;
  left: 0;
  color: var(--fg-dim);
}

.input {
  background: var(--bg);
  border: 1px solid var(--border-strong);
  padding: 6px 10px;
  border-radius: 0;
  font-size: var(--font-size-sm);
  max-height: 200px;
  overflow: auto;
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  color: #c7ccd4;
}

/* ─── AskUserQuestion styles ─────────────────────────────────────────────── */

.question-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.question-text {
  font-size: var(--font-size-base);
  color: var(--fg);
  font-weight: 500;
  padding-left: 2px;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--fg);
  font: inherit;
  font-size: var(--font-size-sm);
  padding: 8px 12px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s, transform 0.1s;
  border-radius: var(--radius-sm);
  min-height: 44px;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}
.option:hover {
  border-color: var(--accent-dim);
  background: var(--bg-chip);
}
.option:active {
  transform: scale(0.99);
}
.option.selected {
  border-color: var(--accent-dim);
  background: rgba(177, 185, 249, 0.1);
  color: var(--accent-dim);
}

.option-marker {
  flex-shrink: 0;
  font-size: 13px;
  margin-top: 1px;
  color: var(--fg-muted);
}
.option.selected .option-marker {
  color: var(--accent-dim);
}

.option-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.option-label {
  font-weight: 500;
}

.option-desc {
  color: var(--fg-muted);
  font-size: 11.5px;
  line-height: 1.4;
  white-space: normal;
}

/* ─── Actions ────────────────────────────────────────────────────────────── */

.actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

button {
  /* 44px min-height satisfies Apple HIG touch target guidelines */
  min-height: 44px;
  padding: 8px 22px;
  border-radius: var(--radius);
  font: inherit;
  font-weight: 600;
  font-size: var(--font-size-base);
  cursor: pointer;
  background: transparent;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s, transform 0.1s;
  flex: 1 1 auto;
  min-width: 100px;
}

.allow {
  color: var(--success);
  border: 1px solid var(--success);
}
.allow:hover:not(:disabled) {
  background: var(--success);
  color: var(--bg);
  box-shadow: 0 4px 12px rgba(78, 186, 101, 0.25);
}
.allow:active:not(:disabled) {
  transform: scale(0.985);
}
.allow:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.deny {
  color: var(--danger);
  border: 1px solid var(--danger);
}
.deny:hover {
  background: var(--danger);
  color: var(--bg);
  box-shadow: 0 4px 12px rgba(255, 107, 128, 0.25);
}
.deny:active {
  transform: scale(0.985);
}
</style>
