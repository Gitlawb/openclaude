import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'

export type TransportCloseHandler = (closeCode?: number) => void
export type TransportDataHandler = (data: string) => void
export type TransportConnectHandler = () => void

export interface Transport {
  connect(): Promise<void> | void
  write(message: StdoutMessage): Promise<void> | void
  close(): void
  setOnData(cb: TransportDataHandler): void
  setOnClose(cb: TransportCloseHandler): void
  setOnConnect?(cb: TransportConnectHandler): void
}
