export const MEMORY_TYPE_VALUES = [
  'User',
  'Project',
  'Local',
  'Managed',
  'AutoMem',
  ...(true ? (['TeamMem'] as const) : []),
] as const

export type MemoryType = (typeof MEMORY_TYPE_VALUES)[number]
