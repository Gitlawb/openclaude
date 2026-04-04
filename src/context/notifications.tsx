import type * as React from 'react';
import { useCallback, useEffect } from 'react';
import { useAppStateStore, useSetAppState } from 'src/state/AppState.js';
import { logError } from '../utils/log.js';
import type { Theme } from '../utils/theme.js';
type Priority = 'low' | 'medium' | 'high' | 'immediate';
type BaseNotification = {
  key: string;
  /**
   * Keys of notifications that this notification invalidates.
   * If a notification is invalidated, it will be removed from the queue
   * and, if currently displayed, cleared immediately.
   */
  invalidates?: string[];
  priority: Priority;
  timeoutMs?: number;
  /**
   * Combine notifications with the same key, like Array.reduce().
   * Called as fold(accumulator, incoming) when a notification with a matching
   * key already exists in the queue or is currently displayed.
   * Returns the merged notification (should carry fold forward for future merges).
   */
  fold?: (accumulator: Notification, incoming: Notification) => Notification;
};
type TextNotification = BaseNotification & {
  text: string;
  color?: keyof Theme;
};
type JSXNotification = BaseNotification & {
  jsx: React.ReactNode;
};
type AddNotificationFn = (content: Notification) => void;
type RemoveNotificationFn = (key: string) => void;
export type Notification = TextNotification | JSXNotification;
const DEFAULT_TIMEOUT_MS = 8000;

// Track current timeout to clear it when immediate notifications arrive
let currentTimeoutId: NodeJS.Timeout | null = null;
export function useNotifications(): {
  addNotification: AddNotificationFn;
  removeNotification: RemoveNotificationFn;
} {
  const store = useAppStateStore();
  const setAppState = useSetAppState();

  // Process queue when current notification finishes or queue changes
  const processQueue = useCallback(() => {
    try {
    setAppState(prev => {
      const next = getNext(prev.notifications.queue);
      if (prev.notifications.current !== null || !next) {
        return prev;
      }
      currentTimeoutId = setTimeout((setAppState, nextKey, processQueue) => {
        currentTimeoutId = null;
        setAppState(prev => {
          // Compare by key instead of reference to handle re-created notifications
          if (prev.notifications.current?.key !== nextKey) {
            return prev;
          }
          return {
            ...prev,
            notifications: {
              queue: prev.notifications.queue,
              current: null
            }
          };
        });
        processQueue();
      }, next.timeoutMs ?? DEFAULT_TIMEOUT_MS, setAppState, next.key, processQueue);
      return {
        ...prev,
        notifications: {
          queue: prev.notifications.queue.filter(_ => _ !== next),
          current: next
        }
      };
    });
    } catch (error) {
      logError(error);
    }
  }, [setAppState]);
  const addNotification = useCallback<AddNotificationFn>((notif: Notification) => {
    try {
    // Handle immediate priority notifications
    if (notif.priority === 'immediate') {
      // Clear any existing timeout since we're showing a new immediate notification
      if (currentTimeoutId) {
        clearTimeout(currentTimeoutId);
        currentTimeoutId = null;
      }

      // Set up timeout for the immediate notification
      currentTimeoutId = setTimeout((setAppState, notif, processQueue) => {
        currentTimeoutId = null;
        setAppState(prev => {
          // Compare by key instead of reference to handle re-created notifications
          if (prev.notifications.current?.key !== notif.key) {
            return prev;
          }
          return {
            ...prev,
            notifications: {
              queue: prev.notifications.queue.filter(_ => !notif.invalidates?.includes(_.key)),
              current: null
            }
          };
        });
        processQueue();
      }, notif.timeoutMs ?? DEFAULT_TIMEOUT_MS, setAppState, notif, processQueue);

      // Show the immediate notification right away
      setAppState(prev => ({
        ...prev,
        notifications: {
          current: notif,
          queue:
          // Only re-queue the current notification if it's not immediate
          [...(prev.notifications.current ? [prev.notifications.current] : []), ...prev.notifications.queue].filter(_ => _.priority !== 'immediate' && !notif.invalidates?.includes(_.key))
        }
      }));
      return; // IMPORTANT: Exit addNotification for immediate notifications
    }

    // Handle non-immediate notifications
    setAppState(prev => {
      // Check if we can fold into an existing notification with the same key
      if (notif.fold) {
        // Fold into current notification if keys match
        if (prev.notifications.current?.key === notif.key) {
          const folded = notif.fold(prev.notifications.current, notif);
          // Reset timeout for the folded notification
          if (currentTimeoutId) {
            clearTimeout(currentTimeoutId);
            currentTimeoutId = null;
          }
          currentTimeoutId = setTimeout((setAppState, foldedKey, processQueue) => {
            currentTimeoutId = null;
            setAppState(p => {
              if (p.notifications.current?.key !== foldedKey) {
                return p;
              }
              return {
                ...p,
                notifications: {
                  queue: p.notifications.queue,
                  current: null
                }
              };
            });
            processQueue();
          }, folded.timeoutMs ?? DEFAULT_TIMEOUT_MS, setAppState, folded.key, processQueue);
          return {
            ...prev,
            notifications: {
              current: folded,
              queue: prev.notifications.queue
            }
          };
        }

        // Fold into queued notification if keys match
        const queueIdx = prev.notifications.queue.findIndex(_ => _.key === notif.key);
        if (queueIdx !== -1) {
          const folded = notif.fold(prev.notifications.queue[queueIdx]!, notif);
          const newQueue = [...prev.notifications.queue];
          newQueue[queueIdx] = folded;
          return {
            ...prev,
            notifications: {
              current: prev.notifications.current,
              queue: newQueue
            }
          };
        }
      }

      // Only add to queue if not already present (prevent duplicates)
      const queuedKeys = new Set(prev.notifications.queue.map(_ => _.key));
      const shouldAdd = !queuedKeys.has(notif.key) && prev.notifications.current?.key !== notif.key;
      if (!shouldAdd) return prev;
      const invalidatesCurrent = prev.notifications.current !== null && notif.invalidates?.includes(prev.notifications.current.key);
      if (invalidatesCurrent && currentTimeoutId) {
        clearTimeout(currentTimeoutId);
        currentTimeoutId = null;
      }
      return {
        ...prev,
        notifications: {
          current: invalidatesCurrent ? null : prev.notifications.current,
          queue: [...prev.notifications.queue.filter(_ => _.priority !== 'immediate' && !notif.invalidates?.includes(_.key)), notif]
        }
      };
    });

    // Process queue after adding the notification
    processQueue();
    } catch (error) {
      logError(error);
    }
  }, [setAppState, processQueue]);
  const removeNotification = useCallback<RemoveNotificationFn>((key: string) => {
    try {
    setAppState(prev => {
      const isCurrent = prev.notifications.current?.key === key;
      const inQueue = prev.notifications.queue.some(n => n.key === key);
      if (!isCurrent && !inQueue) {
        return prev;
      }
      if (isCurrent && currentTimeoutId) {
        clearTimeout(currentTimeoutId);
        currentTimeoutId = null;
      }
      return {
        ...prev,
        notifications: {
          current: isCurrent ? null : prev.notifications.current,
          queue: prev.notifications.queue.filter(n => n.key !== key)
        }
      };
    });
    processQueue();
    } catch (error) {
      logError(error);
    }
  }, [setAppState, processQueue]);

  // Process queue on mount if there are notifications in the initial state.
  // Imperative read (not useAppState) — a subscription in a mount-only
  // effect would be vestigial and make every caller re-render on queue changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect, store is a stable context ref
  useEffect(() => {
    if (store.getState().notifications.queue.length > 0) {
      processQueue();
    }
  }, []);
  return {
    addNotification,
    removeNotification
  };
}
const PRIORITIES: Record<Priority, number> = {
  immediate: 0,
  high: 1,
  medium: 2,
  low: 3
};
export function getNext(queue: Notification[]): Notification | undefined {
  if (queue.length === 0) return undefined;
  return queue.reduce((min, n) => PRIORITIES[n.priority] < PRIORITIES[min.priority] ? n : min);
}
