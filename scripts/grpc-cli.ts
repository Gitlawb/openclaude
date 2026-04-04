import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import path from 'path'
import * as readline from 'readline'

const PROTO_PATH = path.resolve(import.meta.dirname, '../src/proto/openclaude.proto')

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any
const openclaudeProto = protoDescriptor.openclaude.v1

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

function askQuestion(query: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(query, resolve)
  })
}

async function main() {
  const host = process.env.GRPC_HOST || 'localhost'
  const port = process.env.GRPC_PORT || '50051'
  const client = new openclaudeProto.AgentService(
    `${host}:${port}`,
    grpc.credentials.createInsecure()
  )

  let call: grpc.ClientDuplexStream<any, any> | null = null

  const startStream = () => {
    call = client.Chat()
    let textStreamed = false

    call.on('data', async (serverMessage: any) => {
      if (serverMessage.text_chunk) {
        process.stdout.write(serverMessage.text_chunk.text)
        textStreamed = true
      } else if (serverMessage.tool_start) {
        console.log(`\n\x1b[36m[Tool Call]\x1b[0m \x1b[1m${serverMessage.tool_start.tool_name}\x1b[0m`)
        console.log(`\x1b[90m${serverMessage.tool_start.arguments_json}\x1b[0m\n`)
      } else if (serverMessage.tool_result) {
        console.log(`\n\x1b[32m[Tool Result]\x1b[0m \x1b[1m${serverMessage.tool_result.tool_name}\x1b[0m`)
        const out = serverMessage.tool_result.output
        if (out.length > 500) {
          console.log(`\x1b[90m${out.substring(0, 500)}...\n(Output truncated, total length: ${out.length})\x1b[0m`)
        } else {
          console.log(`\x1b[90m${out}\x1b[0m`)
        }
      } else if (serverMessage.action_required) {
        const action = serverMessage.action_required
        console.log(`\n\x1b[33m[Action Required]\x1b[0m`)
        const reply = await askQuestion(`\x1b[1m${action.question}\x1b[0m (y/n) > `)
        
        call?.write({
          input: {
            prompt_id: action.prompt_id,
            reply: reply.trim()
          }
        })
      } else if (serverMessage.done) {
        if (!textStreamed && serverMessage.done.full_text) {
          process.stdout.write(serverMessage.done.full_text)
        }
        textStreamed = false
        console.log('\n\x1b[32m[Generation Complete]\x1b[0m')
        promptUser()
      } else if (serverMessage.error) {
        console.error(`\n\x1b[31m[Server Error]\x1b[0m ${serverMessage.error.message}`)
        promptUser()
      }
    })

    call.on('end', () => {
      console.log('\n\x1b[90m[Stream closed by server]\x1b[0m')
      // Don't prompt user here, let 'done' or 'error' handlers do it
    })

    call.on('error', (err: Error) => {
      console.error('\n\x1b[31m[Stream Error]\x1b[0m', err.message)
      promptUser()
    })
  }

  const promptUser = async () => {
    const message = await askQuestion('\n\x1b[35m> \x1b[0m')
    
    if (message.trim().toLowerCase() === '/exit' || message.trim().toLowerCase() === '/quit') {
      console.log('Bye!')
      rl.close()
      process.exit(0)
    }

    if (!call || call.destroyed) {
      startStream()
    }

    call!.write({
      request: {
        session_id: 'cli-session-1',
        message: message,
        working_directory: process.cwd()
      }
    })
  }

  console.log('\x1b[32mOpenClaude gRPC CLI\x1b[0m')
  console.log('\x1b[90mType /exit to quit.\x1b[0m')
  promptUser()
}

main()
