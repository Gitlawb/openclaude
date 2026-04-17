<script setup lang="ts">
import { computed } from 'vue'
import type { SessionSummary } from '../types'

const props = defineProps<{
  sessions: SessionSummary[]
  selectedId: string
}>()

const emit = defineEmits<{
  select: [sessionId: string]
  back: []
}>()

function shortCwd(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return cwd
  return '.../' + parts.slice(-2).join('/')
}

function timeAgo(startedAt: number): string {
  const diff = Date.now() - startedAt
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'щойно'
  if (mins < 60) return `${mins}хв тому`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}г тому`
  return `${Math.floor(hours / 24)}д тому`
}

const sortedSessions = computed(() =>
  [...props.sessions].sort((a, b) => b.startedAt - a.startedAt)
)
</script>

<template>
  <section class="session-picker">
    <div class="header">
      <button class="link back" @click="emit('back')">&#x2190; налашт.</button>
      <h2>Сесії ({{ sessions.length }})</h2>
    </div>

    <div v-if="sessions.length === 0" class="empty">
      Немає активних сесій. Запусти openclaude і набери /remote on.
    </div>

    <ul v-else class="list">
      <li
        v-for="s in sortedSessions"
        :key="s.id"
        :class="{ active: s.id === selectedId }"
        @click="emit('select', s.id)"
      >
        <div class="row-main">
          <span class="cwd">{{ shortCwd(s.cwd) }}</span>
          <span class="time">{{ timeAgo(s.startedAt) }}</span>
        </div>
        <div class="row-meta">
          <span class="pid">PID {{ s.pid }}</span>
          <span v-if="s.isLoading" class="badge thinking">думає</span>
          <span v-if="s.hasPendingPermission" class="badge perm">дозвіл</span>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.session-picker {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
  padding-left: max(16px, env(safe-area-inset-left));
  padding-right: max(16px, env(safe-area-inset-right));
  max-width: 560px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
}

.header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 14px;
  min-width: 0;
}

.header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--fg);
  letter-spacing: 0.2px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.back {
  background: transparent;
  border: none;
  color: var(--accent);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
  padding: 6px 0;
  min-height: 32px;
  flex-shrink: 0;
}
.back:hover { text-decoration: underline; }

.empty {
  color: var(--fg-muted);
  font-size: var(--font-size-sm);
  padding: 32px 0;
  text-align: center;
  line-height: 1.55;
}

.list {
  list-style: none;
  padding: 0;
  margin: 0;
  min-width: 0;
}

.list li {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 12px 14px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.1s, box-shadow 0.15s;
  background: var(--bg-elev);
  min-width: 0;
  box-shadow: var(--shadow-sm);
}
.list li:hover {
  border-color: var(--accent-dim);
  background: var(--bg-elev-hover);
}
.list li:active {
  transform: scale(0.995);
}
.list li.active {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.08);
  box-shadow: var(--ring-accent);
}

.row-main {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.cwd {
  /* flex:1 + min-width:0 is what lets text-overflow:ellipsis actually work
     inside a flex row — without it, the item refuses to shrink below its
     intrinsic content width and pushes siblings off-screen. */
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 600;
  font-size: var(--font-size-base);
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  font-size: var(--font-size-sm);
  color: var(--fg-muted);
  flex-shrink: 0;
  margin-left: 4px;
}

.row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
  min-width: 0;
}

.pid {
  font-size: var(--font-size-sm);
  color: var(--fg-dim);
}

.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 500;
  letter-spacing: 0.2px;
}
.badge.thinking {
  color: var(--accent);
  border: 1px solid var(--accent-dim);
  background: rgba(var(--accent-rgb), 0.06);
}
.badge.perm {
  color: var(--warning, #f5a623);
  border: 1px solid rgba(245, 166, 35, 0.4);
  background: rgba(245, 166, 35, 0.06);
}
</style>
