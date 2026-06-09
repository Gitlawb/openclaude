import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'

export interface Transport {
  connect(): Promise<void> | void
  write(message: StdoutMessage): Promise<void> | void
  close(): Promise<void> | void
  setOnData(callback: (data: string) => void): void
  setOnClose(callback: (closeCode?: number) => void): void
  setOnConnect?(callback: () => void): void
  setOnEvent?(callback: (event: any) => void): void
  isConnectedStatus?(): boolean
  isClosedStatus?(): boolean
  getStateLabel?(): string
}
