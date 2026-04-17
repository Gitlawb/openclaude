<script setup lang="ts">
defineProps<{ queue: string[] }>()
defineEmits<{ remove: [index: number] }>()
</script>

<template>
  <div v-if="queue.length" class="queue">
    <div class="queue-label">черга</div>
    <div
      v-for="(msg, i) in queue"
      :key="i"
      class="queue-item"
    >
      <span class="queue-index">{{ i + 1 }}</span>
      <span class="queue-text">{{ msg }}</span>
      <button
        class="queue-remove"
        type="button"
        :title="'Видалити і повернути в поле вводу'"
        @click="$emit('remove', i)"
      >✕</button>
    </div>
  </div>
</template>

<style scoped>
.queue {
  flex: 0 0 auto;
  border-top: 1px solid var(--border);
  background: var(--bg-elev);
  padding: 6px 10px;
  padding-left: max(10px, env(safe-area-inset-left));
  padding-right: max(10px, env(safe-area-inset-right));
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 140px;
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}

.queue-label {
  font-size: var(--font-size-sm);
  color: var(--fg-dim);
  letter-spacing: 0.3px;
  padding: 2px 0;
  user-select: none;
}

.queue-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  min-width: 0;
  max-width: 100%;
  transition: border-color 0.12s;
}
.queue-item:hover {
  border-color: var(--border-strong);
}

.queue-index {
  color: var(--fg-dim);
  font-size: var(--font-size-sm);
  flex-shrink: 0;
  min-width: 14px;
  text-align: right;
  user-select: none;
}

.queue-text {
  flex: 1;
  color: var(--fg-muted);
  font-size: var(--font-size-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.queue-remove {
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: var(--fg-dim);
  font-size: 12px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  min-width: 28px;
  min-height: 28px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.12s, background 0.12s;
}
.queue-remove:hover {
  color: var(--danger);
  background: rgba(255, 107, 128, 0.08);
}
</style>
