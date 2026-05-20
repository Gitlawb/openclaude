import { isEnvTruthy } from '../utils/envUtils.js'

export function isNewInitEnabled(): boolean {
  if (false) {
    return (
      process.env.USER_TYPE === 'ant' ||
      isEnvTruthy(process.env.CLAUDE_CODE_NEW_INIT)
    )
  }

  return false
}
