export type QueueOperation = 'enqueue' | 'dequeue'

export type QueueOperationMessage = {
  type: 'queue-operation'
  operation: QueueOperation
  timestamp: string
  sessionId: string
  content?: string
}
