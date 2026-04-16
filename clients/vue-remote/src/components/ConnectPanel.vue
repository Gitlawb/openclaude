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
  max-width: 520px;
  margin: 0 auto;
  width: 100%;
  overflow-y: auto;
}

form {
  border: 1px solid var(--border-strong);
  padding: 18px 20px 20px 20px;
  background: var(--bg-elev);
  position: relative;
}

/* Optional "title bar" on the box — TUI feel */
form::before {
  content: "[ connect ]";
  position: absolute;
  top: -0.7em;
  left: 14px;
  padding: 0 6px;
  background: var(--bg);
  color: var(--accent);
  font-size: var(--font-size-sm);
  letter-spacing: 0.5px;
}

h2 {
  margin: 0 0 4px 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--fg);
}

.hint {
  margin: 0 0 18px 0;
  color: var(--fg-muted);
  font-size: var(--font-size-sm);
  line-height: 1.55;
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
  margin-bottom: 12px;
}

.label-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: var(--font-size-sm);
  color: var(--fg-muted);
  margin-bottom: 4px;
  padding-left: 14px;
  position: relative;
}
.label-row::before {
  content: "─";
  position: absolute;
  left: 0;
  color: var(--fg-dim);
}

.link {
  background: transparent;
  border: none;
  color: var(--accent);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
  padding: 0;
}
.link:hover {
  text-decoration: underline;
}

input {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: 0;
  color: var(--fg);
  padding: 8px 10px;
  font: inherit;
  font-size: var(--font-size-base);
  outline: none;
  transition: border-color 0.12s;
}
input:focus {
  border-color: var(--accent-dim);
}

button.primary {
  width: 100%;
  padding: 9px;
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent-dim);
  border-radius: 0;
  font: inherit;
  font-weight: 600;
  font-size: var(--font-size-base);
  cursor: pointer;
  margin-top: 6px;
  transition: background 0.12s, color 0.12s;
}
button.primary:hover:not(:disabled) {
  background: var(--accent);
  color: var(--bg);
}
button.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error {
  color: var(--danger);
  font-size: var(--font-size-sm);
  margin: 12px 0 0 0;
  padding-left: 14px;
  position: relative;
}
.error::before {
  content: "✗";
  position: absolute;
  left: 0;
}
</style>
