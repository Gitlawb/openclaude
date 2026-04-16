// All user-facing strings in the remote client. Ukrainian only for now —
// add other languages later by splitting into files and selecting at runtime.

export const t = {
  // StatusBar
  status: {
    connected: 'з\'єднано',
    thinking: 'думає…',
    connecting: 'з\'єднання…',
    reconnecting: 'перепідключення…',
    error: 'помилка',
    disconnected: 'не підключено',
  },

  // ConnectPanel
  connect: {
    title: 'Підключення до Нейромережі',
    hint: 'Запусти сервер командою /remote on у сесії Нейромережі, тоді встав сюди URL і токен.',
    url: 'URL сервера',
    useCurrentOrigin: 'використати поточний origin',
    token: 'Токен доступу',
    show: 'показати',
    hide: 'сховати',
    placeholderUrl: 'http://localhost:7842',
    placeholderToken: 'встав токен з /remote on',
    submit: 'Підключитися',
    submitting: 'Підключаюсь…',
    errorRequired: 'Потрібні і URL, і токен.',
    errorInvalidUrl: 'Невірний URL.',
  },

  // Composer
  composer: {
    placeholder: 'Напиши промпт…',
    placeholderDisabled: 'Перепідключення…',
    send: 'Надіслати',
    interrupt: 'Перервати',
  },

  // Messages
  messages: {
    waiting: 'Чекаю на повідомлення…',
    newBadge: '↓ нові',
    empty: '(порожньо)',
    image: '[зображення]',
    okStatus: 'ок',
    errorStatus: 'помилка',
    resultIcon: 'результат',
  },

  // Turn duration ("Cooked for Xm Ys" → "Готувалось Xхв Yс")
  turn: {
    prefix: 'Готувалось',
  },

  // Permission banner
  permission: {
    badge: 'Дозвіл',
    deny: 'Відхилити',
    allow: 'Дозволити',
  },

  // Connection lifecycle errors
  errors: {
    notSent: 'Немає зв\'язку — повідомлення не надіслано.',
    superseded: 'Інший клієнт підключився з тим же токеном.',
    stopped: 'Віддалену сесію зупинено.',
    connection: 'Помилка з\'єднання — перевір URL і токен.',
    connectFailed: 'Не вдалося підключитися. Перевір URL і токен.',
    server: 'Помилка сервера',
    openFailed: 'Не вдалося відкрити WebSocket',
  },
} as const

/**
 * Format a duration in milliseconds as a compact Ukrainian phrase.
 * Examples:  3500 → "4с"  ·  72000 → "1хв 12с"  ·  3661000 → "1г 1хв 1с"
 */
export function formatDurationUk(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0с'
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}г`)
  if (m > 0) parts.push(`${m}хв`)
  if (s > 0 || parts.length === 0) parts.push(`${s}с`)
  return parts.join(' ')
}
