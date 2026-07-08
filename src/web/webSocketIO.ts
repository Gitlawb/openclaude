import { PassThrough } from 'stream'
import type WebSocket from 'ws'
import type {
  StdoutMessage,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import { StructuredIO } from '../cli/structuredIO.js'

/**
 * StructuredIO implementation that communicates over a WebSocket.
 *
 * - User messages from the WebSocket client are fed into the input PassThrough
 *   as NDJSON lines (StructuredIO.read() parses them)
 * - Overrides write() to send StdoutMessage JSON over the WebSocket
 * - Supports the SDK permission flow via createCanUseTool() +
 *   injectControlResponse()
 */
export class WebSocketStructuredIO extends StructuredIO {
  inputStream: PassThrough
  private ws: WebSocket

  constructor(ws: WebSocket) {
    const inputStream = new PassThrough({ encoding: 'utf8' })
    super(inputStream)
    this.inputStream = inputStream
    this.ws = ws
  }

  /** Feed a JSON-encoded NDJSON line into the input stream. */
  feedLine(line: string): void {
    this.inputStream.write(line.endsWith('\n') ? line : line + '\n')
  }

  /** Send a StdoutMessage over the WebSocket as JSON. */
  async write(message: StdoutMessage): Promise<void> {
    if (this.ws.readyState === 1) {
      // WebSocket.OPEN
      this.ws.send(JSON.stringify(message))
    }
  }

  /** Inject a control_response to resolve a pending permission request. */
  handlePermissionResponse(
    requestId: string,
    approved: boolean,
    toolUseID?: string,
  ): void {
    const response: SDKControlResponse = {
      type: 'control_response',
      response: {
        request_id: requestId,
        subtype: 'success',
        response: {
          behavior: approved ? 'allow' : 'deny',
          message: approved ? undefined : 'User denied via web UI',
          toolUseID,
        },
      },
    } as unknown as SDKControlResponse
    this.injectControlResponse(response)
  }

  close(): void {
    this.inputStream.end()
  }
}
