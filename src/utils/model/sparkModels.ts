/**
 * Spark (iFlytek 星火) model list for the /model picker.
 */

import type { ModelOption } from './modelOptions.js'
import { isEnvTruthy } from '../envUtils.js'

export function isSparkProvider(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_SPARK)) {
    return true
  }
  const baseUrl = process.env.SPARK_BASE_URL ?? ''
  if (baseUrl.includes('xf-yun') || baseUrl.includes('spark-api')) {
    return true
  }
  return false
}

function getSparkModels(): ModelOption[] {
  return [
    { value: 'generalv4.0', label: 'Spark 4.0 Ultra', description: 'Latest flagship model - best reasoning' },
    { value: 'generalv4', label: 'Spark 4.0', description: 'High-capability model' },
    { value: 'generalv3.5', label: 'Spark 3.5', description: 'Balanced performance' },
    { value: 'general', label: 'Spark 2.0', description: 'Standard model' },
    { value: 'pro-128k', label: 'Spark Pro 128K', description: 'Extended context window (128K)' },
    { value: 'lite', label: 'Spark Lite', description: 'Fast & low cost' },
    { value: 'max-32k', label: 'Spark Max 32K', description: 'High performance (32K context)' },
    { value: '4.0Ultra', label: 'Spark 4.0 Ultra', description: 'Premium reasoning model' },
  ]
}

let cachedSparkOptions: ModelOption[] | null = null

export function getCachedSparkModelOptions(): ModelOption[] {
  if (!cachedSparkOptions) {
    cachedSparkOptions = getSparkModels()
  }
  return cachedSparkOptions
}
