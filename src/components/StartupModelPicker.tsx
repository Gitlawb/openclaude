/**
 * StartupModelPicker — standalone Ink component shown when --modellist is passed.
 *
 * Renders before the main REPL starts. The caller creates an Ink render instance,
 * waits for onSelect to fire, then unmounts and continues with the selected model.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from '../ink.js'
import type { OpenRouterModel } from '../utils/openRouterModels.js'

type Props = {
  models: OpenRouterModel[]
  loading: boolean
  error: string | null
  providerLabel: string
  onSelect: (modelId: string) => void
  onCancel: () => void
}

const PAGE_SIZE = 14

function formatPrice(price: number | null): string {
  if (price === null) return ''
  if (price === 0) return ' · free'
  if (price < 0.01) return ` · $${price.toFixed(4)}/Mtok`
  return ` · $${price.toFixed(2)}/Mtok`
}

function formatContext(len: number): string {
  if (!len) return ''
  if (len >= 1_000_000) return ` · ${(len / 1_000_000).toFixed(0)}M ctx`
  if (len >= 1_000) return ` · ${Math.round(len / 1000)}K ctx`
  return ` · ${len} ctx`
}

export function StartupModelPicker({
  models,
  loading,
  error,
  providerLabel,
  onSelect,
  onCancel,
}: Props) {
  const [filter, setFilter] = useState('')
  const [cursor, setCursor] = useState(0)

  const filtered = useMemo(() => {
    if (!filter) return models
    const q = filter.toLowerCase()
    return models.filter(
      m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    )
  }, [models, filter])

  // Reset cursor when filter changes
  useEffect(() => {
    setCursor(0)
  }, [filter])

  const pageStart = Math.max(0, Math.min(cursor - Math.floor(PAGE_SIZE / 2), filtered.length - PAGE_SIZE))
  const visible = filtered.slice(pageStart, pageStart + PAGE_SIZE)

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      onCancel()
      return
    }

    if (key.upArrow) {
      setCursor(c => Math.max(0, c - 1))
      return
    }
    if (key.downArrow) {
      setCursor(c => Math.min(filtered.length - 1, c + 1))
      return
    }
    if (key.pageDown) {
      setCursor(c => Math.min(filtered.length - 1, c + PAGE_SIZE))
      return
    }
    if (key.pageUp) {
      setCursor(c => Math.max(0, c - PAGE_SIZE))
      return
    }
    if (key.return) {
      const selected = filtered[cursor]
      if (selected) onSelect(selected.id)
      return
    }
    if (key.backspace || key.delete) {
      setFilter(f => f.slice(0, -1))
      return
    }
    // Printable chars — add to filter
    if (input && !key.ctrl && !key.meta) {
      setFilter(f => f + input)
    }
  })

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="claude">
          Model List
        </Text>
        <Text dimColor>Fetching models from {providerLabel}…</Text>
      </Box>
    )
  }

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="red">
          Failed to fetch models
        </Text>
        <Text dimColor>{error}</Text>
        <Text dimColor>Press Esc to cancel</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="claude">
          Select model
        </Text>
        <Text dimColor> · {providerLabel}</Text>
        {filtered.length !== models.length && (
          <Text dimColor>
            {' '}({filtered.length}/{models.length})
          </Text>
        )}
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>Filter: </Text>
        <Text>{filter || ' '}</Text>
        <Text dimColor>▌</Text>
      </Box>

      {visible.length === 0 ? (
        <Text dimColor>No models match "{filter}"</Text>
      ) : (
        visible.map((m, i) => {
          const absoluteIdx = pageStart + i
          const selected = absoluteIdx === cursor
          return (
            <Box key={m.id} flexDirection="row">
              <Text color={selected ? 'claude' : undefined} bold={selected}>
                {selected ? '▶ ' : '  '}
              </Text>
              <Box flexDirection="column">
                <Text bold={selected} color={selected ? 'claude' : undefined}>
                  {m.id}
                </Text>
                {m.name !== m.id && (
                  <Text dimColor>
                    {'  '}
                    {m.name}
                    {formatContext(m.contextLength)}
                    {formatPrice(m.promptPricePerMToken)}
                  </Text>
                )}
                {m.name === m.id && (m.contextLength > 0 || m.promptPricePerMToken !== null) && (
                  <Text dimColor>
                    {'  '}
                    {formatContext(m.contextLength).replace(' · ', '')}
                    {formatPrice(m.promptPricePerMToken)}
                  </Text>
                )}
              </Box>
            </Box>
          )
        })
      )}

      {filtered.length > PAGE_SIZE && (
        <Box marginTop={1}>
          <Text dimColor>
            {cursor + 1}/{filtered.length} · PgUp/PgDn to scroll
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter confirm · Esc cancel · type to filter</Text>
      </Box>
    </Box>
  )
}
