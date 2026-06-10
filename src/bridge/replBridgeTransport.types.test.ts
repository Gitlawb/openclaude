import type { ReplBridgeTransport } from './replBridgeTransport.js'

type AssertPromiseVoid<T extends Promise<void>> = T

type _CloseReturnsPromise = AssertPromiseVoid<
  ReturnType<ReplBridgeTransport['close']>
>
