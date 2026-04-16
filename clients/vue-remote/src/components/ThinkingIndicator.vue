<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

// Fallback list used only when the server doesn't send a verb
// (e.g. connecting to an older openclaude version).
const FALLBACK_VERBS = [
  'Чаклуємо', 'Шаманимо', 'Химичимо', 'Варимо борщ', 'Ліпимо вареники',
  'Смажимо деруни', 'Заварюємо каву', 'Мішаємо зілля', 'Кодимо', 'Думаємо',
  'Міркуємо', 'Розмірковуємо', 'Креативимо', 'Медитуємо', 'Бубонимо',
  'Гуглимо в голові', 'Збираємо думки', 'Ловимо натхнення', 'Плетемо логіку',
  'Куємо код', 'Шліфуємо ідею', 'Розплутуємо клубок', 'Запрягаємо нейрони',
  'Калібруємо вайб', 'Радимось з котом', 'Натираємо лампу', 'Вичакловуємо',
  'Жонглюємо байтами', 'Полюємо на баг', 'Чухаємо потилицю',
  'Шукаємо істину', 'Печемо пиріжки', 'Плюскаємось у коді',
  'Гортаємо Stack Overflow', 'Дивимось у стелю',
]

const FRAMES = ['◐', '◓', '◑', '◒']

const props = defineProps<{ verb?: string }>()

const frame = ref(0)
// Fallback: pick a random verb once and keep it (matches TUI behaviour).
const fallbackVerb = FALLBACK_VERBS[Math.floor(Math.random() * FALLBACK_VERBS.length)]!

const displayVerb = computed(() => props.verb ?? fallbackVerb)

const frameTimer = setInterval(() => {
  frame.value = (frame.value + 1) % FRAMES.length
}, 120)

onUnmounted(() => clearInterval(frameTimer))
</script>

<template>
  <div class="thinking">
    <span class="spin">{{ FRAMES[frame] }}</span>
    <span class="verb">{{ displayVerb }}…</span>
  </div>
</template>

<style scoped>
.thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0 2px 16px;
  color: var(--accent);
  font-size: var(--font-size-base);
  line-height: var(--line-height);
}

.spin {
  font-size: 13px;
  flex-shrink: 0;
}

.verb {
  opacity: 0.85;
}
</style>
