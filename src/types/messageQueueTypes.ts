export type QueuePriority = 'now' | 'next' | 'later'

export type QueueOperation =
  | 'enqueue'
  | 'dequeue'
  | 'clear'
  | 'requeue'
  | 'interrupt'
  | string

export type QueueOperationMessage = {
  type: 'queue-operation'
  operation: QueueOperation
  timestamp: string
  sessionId: string
  content?: string
}
