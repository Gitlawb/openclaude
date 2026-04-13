import React, { useCallback, useRef, useState } from 'react';
import { getModeFromInput } from 'src/components/PromptInput/inputModes.js';
import { useNotifications } from 'src/context/notifications.js';
import { ConfigurableShortcutHint } from '../components/ConfigurableShortcutHint.js';
import { FOOTER_TEMPORARY_STATUS_TIMEOUT } from '../components/PromptInput/Notifications.js';
import { getHistory } from '../history.js';
import { Text } from '../ink.js';
import type { PromptInputMode } from '../types/textInputTypes.js';
import type { HistoryEntry, PastedContent } from '../utils/config.js';
export type HistoryMode = PromptInputMode;

// Load history entries in chunks to reduce disk reads on rapid keypresses
const HISTORY_CHUNK_SIZE = 10;

// Shared state for batching concurrent load requests into a single disk read
// Mode filter is included to ensure we don't mix filtered and unfiltered caches
let pendingLoad: Promise<HistoryEntry[]> | null = null;
let pendingLoadTarget = 0;
let pendingLoadModeFilter: HistoryMode | undefined = undefined;
async function loadHistoryEntries(minCount: number, modeFilter?: HistoryMode): Promise<HistoryEntry[]> {
  // Round up to next chunk to avoid repeated small reads
  const target = Math.ceil(minCount / HISTORY_CHUNK_SIZE) * HISTORY_CHUNK_SIZE;

  // If a load is already pending with the same mode filter and will satisfy our needs, wait for it
  if (pendingLoad && pendingLoadTarget >= target && pendingLoadModeFilter === modeFilter) {
    return pendingLoad;
  }

  // If a load is pending but won't satisfy our needs or has different filter, we need to wait for it
  // to complete first, then start a new one (can't interrupt an ongoing read)
  if (pendingLoad) {
    await pendingLoad;
  }

  // Start a new load
  pendingLoadTarget = target;
  pendingLoadModeFilter = modeFilter;
  pendingLoad = (async () => {
    const entries: HistoryEntry[] = [];
    let loaded = 0;
    for await (const entry of getHistory()) {
      // If mode filter is specified, only include entries that match the mode
      if (modeFilter) {
        const entryMode = getModeFromInput(entry.display);
        if (entryMode !== modeFilter) {
          continue;
        }
      }
      entries.push(entry);
      loaded++;
      if (loaded >= pendingLoadTarget) break;
    }
    return entries;
  })();
  try {
    return await pendingLoad;
  } finally {
    pendingLoad = null;
    pendingLoadTarget = 0;
    pendingLoadModeFilter = undefined;
  }
}
export function useArrowKeyHistory(onSetInput: (value: string, mode: HistoryMode, pastedContents: Record<number, PastedContent>) => void, currentInput: string, pastedContents: Record<number, PastedContent>, setCursorOffset?: (offset: number) => void, currentMode?: HistoryMode): {
  historyIndex: number;
  setHistoryIndex: (index: number) => void;
  onHistoryUp: () => void;
  onHistoryDown: () => boolean;
  resetHistory: () => void;
  dismissSearchHint: () => void;
} {
  const [historyIndex, setHistoryIndex] = useState(0);
  const [lastShownHistoryEntry, setLastShownHistoryEntry] = useState<(HistoryEntry & {
    mode?: HistoryMode;
  }) | undefined>(undefined);
  const hasShownSearchHintRef = useRef(false);
  const {
    addNotification,
    removeNotification
  } = useNotifications();

  // Cache loaded history entries
  const historyCache = useRef<HistoryEntry[]>([]);
  // Track which mode filter the cache was loaded with
  const historyCacheModeFilter = useRef<HistoryMode | undefined>(undefined);

  // Synchronous tracker for history index to avoid stale closure issues
  // React state updates are async, so rapid keypresses can see stale values
  const historyIndexRef = useRef(0);

  // Track the mode filter that was active when history navigation started
  // This is set on the first arrow press and stays fixed until reset
  const initialModeFilterRef = useRef<HistoryMode | undefined>(undefined);

  // Refs to track current input values for draft preservation
  // These ensure we capture the draft with the latest values, not stale closure values
  const currentInputRef = useRef(currentInput);
  const pastedContentsRef = useRef(pastedContents);
  const currentModeRef = useRef(currentMode);

  // Keep refs in sync with props (synchronous update on each render)
  currentInputRef.current = currentInput;
  pastedContentsRef.current = pastedContents;
  currentModeRef.current = currentMode;
  const setInputWithCursor = useCallback((value: string, mode: HistoryMode, contents: Record<number, PastedContent>, cursorToStart = false): void => {
    onSetInput(value, mode, contents);
    setCursorOffset?.(cursorToStart ? 0 : value.length);
  }, [onSetInput, setCursorOffset]);
  const updateInput = useCallback((input: HistoryEntry | undefined, cursorToStart_0 = false): void => {
    if (!input || !input.display) return;
    const mode_0 = getModeFromInput(input.display);
    const value_0 = mode_0 === 'bash' ? input.display.slice(1) : input.display;
    setInputWithCursor(value_0, mode_0, input.pastedContents ?? {}, cursorToStart_0);
  }, [setInputWithCursor]);
  const showSearchHint = useCallback((): void => {
    addNotification({
      key: 'search-history-hint',
      jsx: <Text dimColor>
          <ConfigurableShortcutHint action="history:search" context="Global" fallback="ctrl+r" description="search history" />
        </Text>,
      priority: 'immediate',
      timeoutMs: FOOTER_TEMPORARY_STATUS_TIMEOUT
    });
  }, [addNotification]);
  const onHistoryUp = useCallback((): void => {
    // Capture and increment synchronously to handle rapid keypresses
    const targetIndex = historyIndexRef.current;
    historyIndexRef.current++;
    const inputAtPress = currentInputRef.current;
    const pastedContentsAtPress = pastedContentsRef.current;
    const modeAtPress = currentModeRef.current;
    if (targetIndex === 0) {
      initialModeFilterRef.current = modeAtPress === 'bash' ? modeAtPress : undefined;

      // Save draft synchronously using refs for the latest values
      // This ensures we capture the draft before any async operations or re-renders
      const hasInput = inputAtPress.trim() !== '';
      setLastShownHistoryEntry(hasInput ? {
        display: inputAtPress,
        pastedContents: pastedContentsAtPress,
        mode: modeAtPress
      } : undefined);
    }
    const modeFilter = initialModeFilterRef.current;
    void (async () => {
      const neededCount = targetIndex + 1; // How many entries we need

      // If mode filter changed, invalidate cache
      if (historyCacheModeFilter.current !== modeFilter) {
        historyCache.current = [];
        historyCacheModeFilter.current = modeFilter;
        historyIndexRef.current = 0;
      }

      // Load more entries if needed
      if (historyCache.current.length < neededCount) {
        // Batches concurrent requests - rapid keypresses share a single disk read
        const entries = await loadHistoryEntries(neededCount, modeFilter);
        // Only update cache if we loaded more than currently cached
        // (handles race condition where multiple loads complete out of order)
        if (entries.length > historyCache.current.length) {
          historyCache.current = entries;
        }
      }

      // Check if we can navigate
      if (targetIndex >= historyCache.current.length) {
        // Rollback the ref since we can't navigate
        historyIndexRef.current--;
        // Keep the draft intact - user stays on their current input
        return;
      }
      const newIndex = targetIndex + 1;
      setHistoryIndex(newIndex);
      updateInput(historyCache.current[targetIndex], true);

      // Show hint once per session after navigating through 2 history entries
      if (newIndex >= 2 && !hasShownSearchHintRef.current) {
        hasShownSearchHintRef.current = true;
        showSearchHint();
      }
    })();
  }, [updateInput, showSearchHint]);
  const onHistoryDown = useCallback((): boolean => {
    // Use the ref for consistent reads
    const currentIndex = historyIndexRef.current;
    if (currentIndex > 1) {
      historyIndexRef.current--;
      setHistoryIndex(currentIndex - 1);
      updateInput(historyCache.current[currentIndex - 2]);
    } else if (currentIndex === 1) {
      historyIndexRef.current = 0;
      setHistoryIndex(0);
      if (lastShownHistoryEntry) {
        // Restore the draft with its saved mode if available
        const savedMode = lastShownHistoryEntry.mode;
        if (savedMode) {
          setInputWithCursor(lastShownHistoryEntry.display, savedMode, lastShownHistoryEntry.pastedContents ?? {});
        } else {
          updateInput(lastShownHistoryEntry);
        }
      } else {
        // When in filtered mode, stay in that mode when clearing input
        setInputWithCursor('', initialModeFilterRef.current ?? 'prompt', {});
      }
    }
    return currentIndex <= 0;
  }, [lastShownHistoryEntry, updateInput, setInputWithCursor]);
  const resetHistory = useCallback((): void => {
    setLastShownHistoryEntry(undefined);
    setHistoryIndex(0);
    historyIndexRef.current = 0;
    initialModeFilterRef.current = undefined;
    removeNotification('search-history-hint');
    historyCache.current = [];
    historyCacheModeFilter.current = undefined;
  }, [removeNotification]);
  const dismissSearchHint = useCallback((): void => {
    removeNotification('search-history-hint');
  }, [removeNotification]);
  return {
    historyIndex,
    setHistoryIndex,
    onHistoryUp,
    onHistoryDown,
    resetHistory,
    dismissSearchHint
  };
}
