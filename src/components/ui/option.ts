import type * as React from 'react'

export type Option<TValue = string> = {
  value: TValue
  label: React.ReactNode
  description?: React.ReactNode
}
