/**
 * Types for the unified command queue's session-log entries.
 * Operations are recorded by src/utils/messageQueueManager.ts via
 * recordQueueOperation and persisted as `queue-operation` entries
 * (see Entry in src/types/logs.ts).
 */

/** Mutation kinds performed on the command queue. */
export type QueueOperation = 'enqueue' | 'dequeue' | 'remove' | 'popAll'

/** Session-log entry recording a single queue mutation. */
export type QueueOperationMessage = {
  type: 'queue-operation'
  operation: QueueOperation
  timestamp: string
  sessionId: string
  /** Text content of the affected command, when it was a string prompt. */
  content?: string
}
