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
  padding: 4px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 140px;
  overflow-y: auto;
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
  gap: 6px;
  padding: 3px 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  min-width: 0;
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
  font-size: 11px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  min-width: 20px;
  min-height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.queue-remove:hover {
  color: var(--danger);
}
</style>
