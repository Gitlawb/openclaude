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
  padding: 8px 12px;
  /* Safe-area on the inner bar in case the root app's insets are 0 but the
     device still notches the left/right edge (e.g. landscape iOS). */
  padding-left: max(12px, env(safe-area-inset-left));
  padding-right: max(12px, env(safe-area-inset-right));
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, var(--bg-elev) 0%, var(--bg-elev-hover) 100%);
  min-height: 40px;
  font-size: var(--font-size-sm);
  /* Ensure this row never overflows its flex parent — the source of the
     bug where the header pushed off the right edge on narrow screens. */
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  backdrop-filter: saturate(1.1);
}

.brand {
  color: var(--accent);
  font-weight: 700;
  letter-spacing: 0.2px;
  flex-shrink: 0;
  /* Prevent a long brand string (we keep it short but be defensive) */
  white-space: nowrap;
}
.brand::before {
  content: "⏵ ";
  color: var(--fg-dim);
}

.state {
  flex: 1 1 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-muted);
  font-size: var(--font-size-sm);
  min-width: 0;
  overflow: hidden;
}

.label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex-shrink: 1;
}

.cwd {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-sm);
  color: var(--fg-dim);
  min-width: 0;
  flex-shrink: 1;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--fg-dim);
  transition: background-color 0.25s, box-shadow 0.25s;
}
.dot.on {
  background: var(--success);
  box-shadow: 0 0 0 2px rgba(78, 186, 101, 0.18);
}
.dot.off {
  background: #555b66;
}
.dot.err {
  background: var(--danger);
  box-shadow: 0 0 0 2px rgba(255, 107, 128, 0.18);
}
.dot.pulsing {
  background: var(--accent);
  animation: pulse 1.4s ease-in-out infinite;
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.2);
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}

.settings {
  background: transparent;
  border: none;
  color: var(--fg-muted);
  font-size: 16px;
  cursor: pointer;
  /* Big enough for a finger on mobile; HIG minimum is 44px */
  min-width: 36px;
  min-height: 32px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  line-height: 1;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s, transform 0.1s;
}
.settings:hover {
  color: var(--accent);
  background: var(--bg-chip);
}
.settings:active {
  transform: scale(0.94);
}
</style>
