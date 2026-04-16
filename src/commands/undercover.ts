import {
  getUndercoverActive,
  setUndercoverActive,
} from '../bootstrap/state.js'
import type { Command } from '../commands.js'
import type { LocalCommandCall } from '../types/command.js'

const call: LocalCommandCall = async args => {
  const arg = args.trim().toLowerCase()

  if (arg === '' || arg === 'status') {
    return {
      type: 'text',
      value: `Інкогніто: ${getUndercoverActive() ? 'увімкнено' : 'вимкнено'}\nВикористай "/undercover on" або "/undercover off" для перемикання. За замовчуванням увімкнено; запусти з OPENCLAUDE_UNDERCOVER=0 щоб вимкнути.`,
    }
  }

  if (arg === 'on' || arg === 'enable' || arg === 'true' || arg === '1') {
    setUndercoverActive(true)
    return {
      type: 'text',
      value:
        'Режим інкогніто увімкнено. Самоідентифікацію моделі придушено, атрибуцію з комітів/PR прибрано, інструкції анти-ідентифікації додано до системних промптів. Зверни увагу: вже зібрані системні промпти в поточному повідомленні можуть бути кешовані; зміни повністю набудуть чинності з наступного повідомлення.',
    }
  }

  if (arg === 'off' || arg === 'disable' || arg === 'false' || arg === '0') {
    setUndercoverActive(false)
    return {
      type: 'text',
      value:
        'Режим інкогніто вимкнено. Co-Authored-By та атрибуцію відновлено для наступного коміту/PR. Самоідентифікацію моделі відновлено в наступному системному промпті.',
    }
  }

  if (arg === 'toggle') {
    const next = !getUndercoverActive()
    setUndercoverActive(next)
    return {
      type: 'text',
      value: `Інкогніто перемкнено: ${next ? 'увімкнено' : 'вимкнено'}`,
    }
  }

  return {
    type: 'text',
    value: `Невідомий аргумент "${arg}". Використання: /undercover [on|off|toggle|status]`,
  }
}

const undercover = {
  type: 'local',
  name: 'undercover',
  description:
    'Перемкнути режим інкогніто: приховати самоідентифікацію моделі, прибрати AI-атрибуцію з комітів/PR',
  argumentHint: '[on|off|toggle|status]',
  isEnabled: () => true,
  isHidden: false,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default undercover
