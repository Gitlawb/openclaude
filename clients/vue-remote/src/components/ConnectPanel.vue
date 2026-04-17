<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'

const props = defineProps<{
  initialUrl: string
  initialToken: string
  error: string | null
  busy: boolean
}>()

const emit = defineEmits<{
  connect: [url: string, token: string]
}>()

const url = ref(props.initialUrl)
const token = ref(props.initialToken)
const showToken = ref(false)

const currentOrigin = `${window.location.protocol}//${window.location.host}`
const showFillOrigin = computed(() => !url.value.startsWith(currentOrigin))

watch(() => props.initialUrl, v => {
  if (v && !url.value) url.value = v
})

watch(() => props.initialToken, v => {
  if (v && !token.value) token.value = v
})

function onSubmit(e: Event) {
  e.preventDefault()
  emit('connect', url.value.trim(), token.value.trim())
}

function fillCurrentOrigin() {
  url.value = currentOrigin
}
</script>

<template>
  <section class="connect-panel">
    <form @submit="onSubmit">
      <h2>{{ t.connect.title }}</h2>
      <p class="hint">{{ t.connect.hint }}</p>

      <label>
        <span class="label-row">
          <span>{{ t.connect.url }}</span>
          <button
            v-if="showFillOrigin"
            type="button"
            class="link"
            @click="fillCurrentOrigin"
          >
            {{ t.connect.useCurrentOrigin }}
          </button>
        </span>
        <input
          v-model="url"
          type="text"
          :placeholder="t.connect.placeholderUrl"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          inputmode="url"
          required
        />
      </label>

      <label>
        <span class="label-row">
          <span>{{ t.connect.token }}</span>
          <button type="button" class="link" @click="showToken = !showToken">
            {{ showToken ? t.connect.hide : t.connect.show }}
          </button>
        </span>
        <input
          v-model="token"
          :type="showToken ? 'text' : 'password'"
          :placeholder="t.connect.placeholderToken"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          required
        />
      </label>

      <button type="submit" class="primary" :disabled="busy">
        {{ busy ? t.connect.submitting : t.connect.submit }}
      </button>

      <p v-if="error" class="error">{{ error }}</p>
    </form>
  </section>
</template>

<style scoped>
.connect-panel {
  flex: 1;
  padding: 24px 16px;
  padding-left: max(16px, env(safe-area-inset-left));
  padding-right: max(16px, env(safe-area-inset-right));
  max-width: 560px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 0;
}

form {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  padding: 22px 22px 22px 22px;
  background: var(--bg-elev);
  position: relative;
  box-shadow: var(--shadow-md);
  min-width: 0;
}

/* Optional "title bar" on the box — TUI feel, kept but softened */
form::before {
  content: "[ connect ]";
  position: absolute;
  top: -0.7em;
  left: 16px;
  padding: 0 8px;
  background: var(--bg);
  color: var(--accent);
  font-size: var(--font-size-sm);
  letter-spacing: 0.5px;
}

h2 {
  margin: 0 0 6px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--fg);
  letter-spacing: 0.2px;
}

.hint {
  margin: 0 0 20px 0;
  color: var(--fg-muted);
  font-size: var(--font-size-sm);
  line-height: 1.6;
}

code {
  background: transparent;
  border: none;
  padding: 0;
  color: var(--accent);
  font-size: var(--font-size-sm);
}

label {
  display: block;
  margin-bottom: 14px;
}

.label-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  font-size: var(--font-size-sm);
  color: var(--fg-muted);
  margin-bottom: 6px;
  padding-left: 14px;
  position: relative;
  min-width: 0;
}
.label-row::before {
  content: "─";
  position: absolute;
  left: 0;
  color: var(--fg-dim);
}
.label-row > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.link {
  background: transparent;
  border: none;
  color: var(--accent);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
  padding: 4px 0;
  flex-shrink: 0;
}
.link:hover {
  text-decoration: underline;
}

input {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  color: var(--fg);
  padding: 10px 12px;
  /* 44px minimum touch target on mobile */
  min-height: 44px;
  font: inherit;
  font-size: var(--font-size-base);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
input:focus {
  border-color: var(--accent-dim);
  box-shadow: var(--ring-accent);
}

button.primary {
  width: 100%;
  box-sizing: border-box;
  padding: 11px;
  min-height: 44px;
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent-dim);
  border-radius: var(--radius);
  font: inherit;
  font-weight: 600;
  font-size: var(--font-size-base);
  letter-spacing: 0.2px;
  cursor: pointer;
  margin-top: 8px;
  transition: background 0.15s, color 0.15s, transform 0.1s, box-shadow 0.15s;
}
button.primary:hover:not(:disabled) {
  background: var(--accent);
  color: var(--bg);
  box-shadow: 0 4px 14px rgba(var(--accent-rgb), 0.25);
}
button.primary:active:not(:disabled) {
  transform: scale(0.985);
}
button.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error {
  color: var(--danger);
  font-size: var(--font-size-sm);
  margin: 14px 0 0 0;
  padding-left: 16px;
  position: relative;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}
.error::before {
  content: "✗";
  position: absolute;
  left: 0;
}
</style>
