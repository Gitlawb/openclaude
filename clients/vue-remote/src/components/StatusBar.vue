<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../i18n'
import type { ConnectionState } from '../types'

const props = defineProps<{
  connectionState: ConnectionState
  isLoading: boolean
  sessionCwd?: string | null
  canOpenSettings: boolean
}>()

const emit = defineEmits<{
  openSettings: []
}>()

const dotClass = computed(() => {
  switch (props.connectionState) {
    case 'connected':
      return props.isLoading ? 'dot pulsing' : 'dot on'
    case 'connecting':
    case 'reconnecting':
      return 'dot pulsing'
    case 'error':
      return 'dot err'
    default:
      return 'dot off'
  }
})

const label = computed(() => {
  if (props.connectionState === 'connected') {
    return props.isLoading ? t.status.thinking : t.status.connected
  }
  if (props.connectionState === 'connecting') return t.status.connecting
  if (props.connectionState === 'reconnecting') return t.status.reconnecting
  if (props.connectionState === 'error') return t.status.error
  return t.status.disconnected
})
</script>

<template>
  <header class="statusbar">
    <div class="brand">openclaude</div>
    <div class="state">
      <span :class="dotClass"></span>
      <span class="label">{{ label }}</span>
      <span v-if="sessionCwd" class="cwd">· {{ sessionCwd }}</span>
    </div>
    <button
      v-if="canOpenSettings"
      class="settings"
      aria-label="Settings"
      @click="emit('openSettings')"
    >
      ⚙
    </button>
  </header>
</template>

<style scoped>
.statusbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-strong);
  background: var(--bg-elev);
  min-height: 32px;
  font-size: var(--font-size-sm);
}

.brand {
  color: var(--accent);
  font-weight: 600;
  letter-spacing: 0;
}
.brand::before {
  content: "⏵ ";
  color: var(--fg-dim);
}

.state {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-muted);
  font-size: var(--font-size-sm);
  min-width: 0;
}

.label {
  white-space: nowrap;
}

.cwd {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-sm);
  color: var(--fg-dim);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 0;   /* square — more TUI */
  flex-shrink: 0;
  background: var(--fg-dim);
  transition: background-color 0.2s;
}
.dot.on {
  background: var(--success);
}
.dot.off {
  background: #555b66;
}
.dot.err {
  background: var(--danger);
}
.dot.pulsing {
  background: var(--accent);
  animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.settings {
  background: transparent;
  border: none;
  color: var(--fg-muted);
  font-size: 14px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 0;
  line-height: 1;
}
.settings:hover {
  color: var(--accent);
  background: var(--bg-chip);
}
</style>
