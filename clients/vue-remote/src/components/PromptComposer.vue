<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { t } from '../i18n'

const props = defineProps<{
  disabled: boolean
  isLoading: boolean
}>()

const emit = defineEmits<{
  submit: [text: string]
}>()

const text = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)

function autosize() {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

watch(text, autosize, { flush: 'post' })

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}

async function submit() {
  const trimmed = text.value.trim()
  if (!trimmed || props.disabled) return
  emit('submit', trimmed)
  text.value = ''
  await nextTick()
  autosize()
}

async function setText(value: string) {
  text.value = value
  await nextTick()
  autosize()
  textarea.value?.focus()
}

defineExpose({ setText })
</script>

<template>
  <footer class="composer" :class="{ disabled, loading: isLoading }">
    <div class="input-wrap">
      <span class="prompt-prefix" aria-hidden="true">&gt;</span>
      <textarea
        ref="textarea"
        v-model="text"
        :placeholder="disabled ? t.composer.placeholderDisabled : t.composer.placeholder"
        :disabled="disabled"
        rows="1"
        autocomplete="off"
        autocapitalize="sentences"
        @keydown="onKeydown"
      ></textarea>
    </div>
    <button
      type="button"
      class="send"
      :disabled="disabled || !text.trim()"
      :aria-label="isLoading ? t.composer.interrupt : t.composer.send"
      @click="submit"
    >
      <span v-if="isLoading">esc</span>
      <span v-else>⏎</span>
    </button>
  </footer>
</template>

<style scoped>
.composer {
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding: 6px 8px;
  /* Respect iOS home-indicator / notch at the bottom */
  padding-bottom: max(6px, env(safe-area-inset-bottom));
  padding-left: max(8px, env(safe-area-inset-left));
  padding-right: max(8px, env(safe-area-inset-right));
  border-top: 1px solid var(--border-strong);
  background: var(--bg-elev);
  /* Never let the row overflow its parent */
  min-width: 0;
  max-width: 100%;
}

.input-wrap {
  /* flex:1 + min-width:0 = shrinks properly without pushing siblings */
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: var(--bg);
  border: 1px solid var(--border-strong);
  padding: 6px 10px;
  border-radius: 0;
  transition: border-color 0.12s;
}
.input-wrap:focus-within {
  border-color: var(--accent-dim);
}
.composer.disabled .input-wrap {
  opacity: 0.55;
}

.prompt-prefix {
  color: var(--user);
  font-weight: 700;
  line-height: var(--line-height);
  user-select: none;
  flex-shrink: 0;
  margin-top: 1px;
}
.composer.disabled .prompt-prefix {
  color: var(--fg-dim);
}

textarea {
  flex: 1 1 0;
  min-width: 0;
  background: transparent;
  border: none;
  color: var(--fg);
  padding: 0;
  font: inherit;
  font-size: var(--font-size-base);
  resize: none;
  outline: none;
  line-height: var(--line-height);
  max-height: 200px;
  caret-color: var(--user);
}
textarea::placeholder {
  color: var(--fg-dim);
}
textarea:disabled {
  cursor: not-allowed;
}

.send {
  align-self: stretch;
  /* 44px minimum touch target (Apple HIG); stays fixed width */
  min-width: 44px;
  min-height: 44px;
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--border-strong);
  font-size: var(--font-size-sm);
  cursor: pointer;
  /* Never shrink — this is what was going off-screen */
  flex: 0 0 auto;
  padding: 0 10px;
  border-radius: 0;
  transition: border-color 0.12s, color 0.12s;
}
.send:not(:disabled):hover {
  border-color: var(--accent);
  color: var(--accent);
}
.send:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.composer.loading .send {
  color: var(--warning);
  border-color: var(--warning);
}
</style>
