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
  align-items: flex-end;
  gap: 8px;
  padding: 8px 10px;
  /* Respect iOS home-indicator / notch at the bottom */
  padding-bottom: max(8px, env(safe-area-inset-bottom));
  padding-left: max(10px, env(safe-area-inset-left));
  padding-right: max(10px, env(safe-area-inset-right));
  border-top: 1px solid var(--border);
  background: linear-gradient(180deg, var(--bg-elev-hover) 0%, var(--bg-elev) 100%);
  /* Never let the row overflow its parent */
  min-width: 0;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  /* overflow:hidden ensures a child (like the send button on a tiny screen)
     can never visually leak past the rounded composer edge. */
  overflow: hidden;
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
  padding: 8px 12px;
  border-radius: var(--radius);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.input-wrap:focus-within {
  border-color: var(--accent-dim);
  box-shadow: var(--ring-accent);
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
  /* Square-ish 44x44 touch target. align-self: flex-end anchors it to the
     bottom of the composer so a multi-line textarea doesn't pull it up. */
  align-self: flex-end;
  min-width: 44px;
  min-height: 44px;
  height: 44px;
  background: var(--bg-elev);
  color: var(--accent);
  border: 1px solid var(--border-strong);
  font-size: 15px;
  cursor: pointer;
  /* Never shrink — this is what was going off-screen */
  flex: 0 0 auto;
  padding: 0 14px;
  border-radius: var(--radius);
  transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s, box-shadow 0.15s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.send:not(:disabled):hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(var(--accent-rgb), 0.08);
}
.send:not(:disabled):active {
  transform: scale(0.96);
}
.send:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.composer.loading .send {
  color: var(--warning);
  border-color: var(--warning);
  background: rgba(255, 193, 7, 0.08);
}

/* On very narrow screens, the send button uses less horizontal padding. */
@media (max-width: 380px) {
  .composer {
    gap: 6px;
    padding-left: max(6px, env(safe-area-inset-left));
    padding-right: max(6px, env(safe-area-inset-right));
  }
  .send {
    padding: 0 10px;
    min-width: 44px;
  }
}
</style>
