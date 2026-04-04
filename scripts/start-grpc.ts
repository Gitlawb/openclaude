import { GrpcServer } from '../src/grpc/server.ts'
import { init } from '../src/entrypoints/init.ts'

// Polyfill MACRO which is normally injected by the bundler
Object.assign(globalThis, {
  MACRO: {
    VERSION: '0.1.7',
    DISPLAY_VERSION: '0.1.7',
    PACKAGE_URL: '@gitlawb/openclaude',
  }
})

async function main() {
  console.log('Starting OpenClaude gRPC Server...')
  await init()

  const port = process.env.GRPC_PORT ? parseInt(process.env.GRPC_PORT, 10) : 50051
  const host = process.env.GRPC_HOST || 'localhost'
  const server = new GrpcServer()

  server.start(port, host)
}

main().catch((err) => {
  console.error('Fatal error starting gRPC server:', err)
  process.exit(1)
})
