import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { FavoriteModelPricing } from '../../utils/config.js'
import { getSelectedFavoriteModel } from '../../utils/favorites.js'

function formatPrice(value: number): string {
  return value >= 0.1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`
}

function formatContext(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return ''
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M ctx`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k ctx`
  return `${tokens} ctx`
}

function formatPricingLine(p: FavoriteModelPricing): string {
  const parts: string[] = []
  if (p.promptPricePerMToken !== null && p.completionPricePerMToken !== null) {
    parts.push(
      `${formatPrice(p.promptPricePerMToken)} / ${formatPrice(p.completionPricePerMToken)} per Mtok`,
    )
  } else if (p.promptPricePerMToken !== null) {
    parts.push(`${formatPrice(p.promptPricePerMToken)} per Mtok`)
  } else if (p.completionPricePerMToken !== null) {
    parts.push(`${formatPrice(p.completionPricePerMToken)} per Mtok`)
  }
  const ctx = formatContext(p.contextLength)
  if (ctx) parts.push(ctx)
  return parts.join(' · ')
}

export function ModelPricingLine(): React.ReactElement | null {
  const favorite = getSelectedFavoriteModel()
  const pricing = favorite?.pricing
  if (!pricing) return null
  const line = formatPricingLine(pricing)
  if (!line) return null
  return (
    <Box>
      <Text>
        <Text color="inactive">Price</Text>
        <Text dimColor>  {line}</Text>
      </Text>
    </Box>
  )
}
