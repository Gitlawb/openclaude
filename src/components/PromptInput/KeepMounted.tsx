import type { ReactNode } from 'react'
import { Box } from '../../ink.js'

export function KeepMounted({
  hidden,
  children,
}: {
  hidden: boolean
  children: ReactNode
}): ReactNode {
  return (
    <Box height={hidden ? 0 : undefined} overflow="hidden">
      {children}
    </Box>
  )
}
