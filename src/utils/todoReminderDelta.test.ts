import { describe, expect, test } from 'bun:test'
import {
  getTodoReminderDelta,
  type TodoSnapshotItem,
} from './todoReminderDelta.js'

type FakeMsg = {
  type: string
  attachment?: {
    type: string
    snapshot?: Array<{ id: string; status: string }>
  }
}

function priorDelta(
  snapshot: Array<{ id: string; status: string }>,
): FakeMsg {
  return {
    type: 'attachment',
    attachment: { type: 'todo_reminder_delta', snapshot },
  }
}

const a: TodoSnapshotItem = { id: '1', status: 'pending', text: 'task-a' }
const b: TodoSnapshotItem = { id: '2', status: 'pending', text: 'task-b' }
const cInProgress: TodoSnapshotItem = {
  id: '3',
  status: 'in_progress',
  text: 'task-c',
}

describe('getTodoReminderDelta', () => {
  test('emits the full list on the first reminder (isInitial=true)', () => {
    const delta = getTodoReminderDelta([a, b], [])
    expect(delta).not.toBeNull()
    expect(delta!.isInitial).toBe(true)
    expect(delta!.added.map(x => x.id)).toEqual(['1', '2'])
    expect(delta!.snapshot).toEqual([
      { id: '1', status: 'pending' },
      { id: '2', status: 'pending' },
    ])
  })

  test('returns null when state unchanged since last reminder', () => {
    const first = getTodoReminderDelta([a, b], [])!
    const history: FakeMsg[] = [priorDelta(first.snapshot)]
    expect(getTodoReminderDelta([a, b], history)).toBeNull()
  })

  test('detects status change as statusChanged (not add+remove)', () => {
    const first = getTodoReminderDelta([a], [])!
    const history: FakeMsg[] = [priorDelta(first.snapshot)]
    const delta = getTodoReminderDelta(
      [{ id: '1', status: 'completed', text: 'task-a' }],
      history,
    )!
    expect(delta.statusChanged).toEqual([
      {
        id: '1',
        priorStatus: 'pending',
        newStatus: 'completed',
        text: 'task-a',
      },
    ])
    expect(delta.added).toEqual([])
    expect(delta.removedIds).toEqual([])
  })

  test('detects new tasks added since last reminder', () => {
    const first = getTodoReminderDelta([a], [])!
    const history: FakeMsg[] = [priorDelta(first.snapshot)]
    const delta = getTodoReminderDelta([a, cInProgress], history)!
    expect(delta.isInitial).toBe(false)
    expect(delta.added.map(x => x.id)).toEqual(['3'])
    expect(delta.statusChanged).toEqual([])
  })

  test('detects removed tasks', () => {
    const first = getTodoReminderDelta([a, b], [])!
    const history: FakeMsg[] = [priorDelta(first.snapshot)]
    const delta = getTodoReminderDelta([a], history)!
    expect(delta.removedIds).toEqual(['2'])
  })

  test('regression: multiple prior deltas — only last snapshot matters', () => {
    const t1 = getTodoReminderDelta([a], [])!
    const t2 = getTodoReminderDelta([a, b], [priorDelta(t1.snapshot)])!
    const history: FakeMsg[] = [
      priorDelta(t1.snapshot),
      priorDelta(t2.snapshot),
    ]
    // No change from t2's snapshot → no-op.
    expect(getTodoReminderDelta([a, b], history)).toBeNull()
  })

  test('copy elision: two consecutive scans with same state both no-op', () => {
    const first = getTodoReminderDelta([a], [])!
    const history: FakeMsg[] = [priorDelta(first.snapshot)]
    expect(getTodoReminderDelta([a], history)).toBeNull()
    expect(getTodoReminderDelta([a], history)).toBeNull()
  })

  test('deterministic output: sorted by id', () => {
    const delta = getTodoReminderDelta(
      [
        { id: 'z', status: 'pending', text: 'zzz' },
        { id: 'a', status: 'pending', text: 'aaa' },
      ],
      [],
    )!
    expect(delta.added.map(x => x.id)).toEqual(['a', 'z'])
    expect(delta.snapshot.map(x => x.id)).toEqual(['a', 'z'])
  })

  // Defensive: `status` is typed as string, but runtime-built snapshots
  // from upstream helpers could theoretically pass undefined. The
  // scanner must NOT interpret undefined as a status transition.
  test('status defensive: undefined status is treated as empty string, not as transition', () => {
    const withEmpty = getTodoReminderDelta(
      [{ id: 'x', status: '' as unknown as string, text: 'no status' }],
      [],
    )!
    expect(withEmpty.added[0]!.status).toBe('')

    // Simulate a prior delta that announced 'x' with empty status.
    const priorSnapshot: FakeMsg = {
      type: 'attachment',
      attachment: {
        type: 'todo_reminder_delta',
        snapshot: [{ id: 'x', status: '' }],
      },
    }
    // Same item, same status: must be a no-op (not a phantom change).
    expect(
      getTodoReminderDelta(
        [{ id: 'x', status: '' as unknown as string, text: 'no status' }],
        [priorSnapshot],
      ),
    ).toBeNull()
  })
})
