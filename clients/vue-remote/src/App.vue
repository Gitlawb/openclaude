<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import ConnectPanel from './components/ConnectPanel.vue'
import MessageList from './components/MessageList.vue'
import PermissionBanner from './components/PermissionBanner.vue'
import PromptComposer from './components/PromptComposer.vue'
import QueuedMessages from './components/QueuedMessages.vue'
import SessionPicker from './components/SessionPicker.vue'
import StatusBar from './components/StatusBar.vue'
import { useRemoteSession } from './composables/useRemoteSession'
import { useLocalStorage } from './composables/useStorage'
import { t } from './i18n'

const LS_URL = 'openclaude.remote.url'
const LS_TOKEN = 'openclaude.remote.token'

const storedUrl = useLocalStorage(LS_URL, window.location.origin)
const storedToken = useLocalStorage(LS_TOKEN, '')

const session = useRemoteSession()
const {
  connectionState,
  isLoading,
  spinnerVerb,
  messages,
  pendingPermission,
  error,
  sessionInfo,
  sessions,
  selectedSessionId,
} = session

// UI state: 'connect' | 'sessions' | 'chat'
const screen = ref<'connect' | 'sessions' | 'chat'>('connect')

onMounted(() => {
  // Auto-connect if we have stored creds.
  if (storedUrl.value && storedToken.value) {
    screen.value = 'sessions'
    session.connect(storedUrl.value, storedToken.value)
  }

  // Обробка повороту екрана для мобільних пристроїв
  window.addEventListener('orientationchange', () => {
    // Примусовий рефлоу для виправлення розмірів після повороту
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 100)
  })
})

function handleConnect(url: string, token: string) {
  storedUrl.value = url
  storedToken.value = token
  screen.value = 'sessions'
  session.connect(url, token)
}

function openSettings() {
  session.disconnect()
  screen.value = 'connect'
}

function handleSelectSession(sessionId: string) {
  session.selectSession(sessionId)
  screen.value = 'chat'
}

function backToSessions() {
  selectedSessionId.value = ''
  screen.value = 'sessions'
}

function onPromptSubmit(text: string) {
  if (isLoading.value) {
    queue.value.push(text)
    return
  }
  const ok = session.sendPrompt(text)
  if (!ok) {
    error.value = t.errors.notSent
  }
}

function removeFromQueue(index: number) {
  const [removed] = queue.value.splice(index, 1)
  if (removed !== undefined) composer.value?.setText(removed)
}

function onAllow(requestId: string, message?: string) {
  session.respondToPermission(requestId, 'allow', message)
}
function onDeny(requestId: string) {
  session.respondToPermission(requestId, 'deny')
}

const shortCwd = computed(() => {
  const cwd = sessionInfo.value?.cwd
  if (!cwd) return null
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return cwd
  return '.../' + parts.slice(-2).join('/')
})

const composerDisabled = computed(() =>
  connectionState.value !== 'connected' || !selectedSessionId.value,
)

// ─── Message queue ────────────────────────────────────────────────────────────

const queue = ref<string[]>([])
const composer = ref<InstanceType<typeof PromptComposer> | null>(null)

// Auto-drain: when loading finishes, send the next queued message.
watch(isLoading, (loading, wasLoading) => {
  if (wasLoading && !loading && queue.value.length > 0) {
    const next = queue.value.shift()!
    session.sendPrompt(next)
  }
})

// Clear queue when switching sessions.
watch(selectedSessionId, () => {
  queue.value = []
})
</script>

<template>
  <div class="app">
    <StatusBar
      :connection-state="connectionState"
      :is-loading="isLoading"
      :session-cwd="screen === 'chat' ? shortCwd : null"
      :can-open-settings="screen !== 'connect'"
      @open-settings="openSettings"
    />

    <ConnectPanel
      v-if="screen === 'connect'"
      :initial-url="storedUrl"
      :initial-token="storedToken"
      :error="error"
      :busy="connectionState === 'connecting'"
      @connect="handleConnect"
    />

    <SessionPicker
      v-else-if="screen === 'sessions'"
      :sessions="sessions"
      :selected-id="selectedSessionId"
      @select="handleSelectSession"
      @back="openSettings"
    />

    <template v-else>
      <div class="session-bar">
        <button class="link" @click="backToSessions">&#x2190; сесії</button>
        <span v-if="shortCwd" class="session-cwd">{{ shortCwd }}</span>
      </div>

      <MessageList :messages="messages" :is-loading="isLoading" :spinner-verb="spinnerVerb" />

      <Transition name="banner">
        <PermissionBanner
          v-if="pendingPermission"
          :request="pendingPermission"
          @allow="onAllow"
          @deny="onDeny"
        />
      </Transition>

      <div v-if="error && connectionState !== 'connected'" class="error-bar">
        {{ error }}
      </div>

      <QueuedMessages
        v-if="queue.length"
        :queue="queue"
        @remove="removeFromQueue"
      />

      <PromptComposer
        ref="composer"
        :disabled="composerDisabled"
        :is-loading="isLoading"
        @submit="onPromptSubmit"
      />
    </template>
  </div>
</template>

<style>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  width: 100%;
  max-width: 100%;
}

.session-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  padding-left: max(12px, env(safe-area-inset-left));
  padding-right: max(12px, env(safe-area-inset-right));
  font-size: var(--font-size-sm);
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  min-height: 32px;
}
.session-bar .link {
  background: transparent;
  border: none;
  color: var(--accent);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
  padding: 4px 0;
  min-height: 28px;
  flex-shrink: 0;
}
.session-bar .link:hover { text-decoration: underline; }
.session-bar .session-cwd {
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1 1 auto;
}

.error-bar {
  background: rgba(255, 135, 135, 0.08);
  color: var(--danger);
  padding: 6px 12px 6px 28px;
  padding-left: max(28px, env(safe-area-inset-left));
  padding-right: max(12px, env(safe-area-inset-right));
  font-size: var(--font-size-sm);
  border-top: 1px solid rgba(255, 135, 135, 0.25);
  position: relative;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  min-width: 0;
  max-width: 100%;
}
.error-bar::before {
  content: "✗";
  position: absolute;
  left: 12px;
  top: 6px;
}

.banner-enter-active,
.banner-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.banner-enter-from,
.banner-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
