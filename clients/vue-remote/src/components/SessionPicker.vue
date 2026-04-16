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
  padding: 12px 16px;
  max-width: 520px;
  margin: 0 auto;
  width: 100%;
}

.header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}

.header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--fg);
}

.back {
  background: transparent;
  border: none;
  color: var(--accent);
  font: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
  padding: 0;
}
.back:hover { text-decoration: underline; }

.empty {
  color: var(--fg-muted);
  font-size: var(--font-size-sm);
  padding: 24px 0;
  text-align: center;
}

.list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.list li {
  border: 1px solid var(--border-strong);
  padding: 10px 12px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
  background: var(--bg-elev);
}
.list li:hover {
  border-color: var(--accent-dim);
}
.list li.active {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb, 100, 200, 255), 0.08);
}

.row-main {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.cwd {
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
  margin-left: 8px;
}

.row-meta {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.pid {
  font-size: var(--font-size-sm);
  color: var(--fg-dim);
}

.badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 2px;
}
.badge.thinking {
  color: var(--accent);
  border: 1px solid var(--accent-dim);
}
.badge.perm {
  color: var(--warning, #f5a623);
  border: 1px solid rgba(245, 166, 35, 0.4);
}
</style>
