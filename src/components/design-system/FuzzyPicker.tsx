import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { useEffect, useState } from 'react';
import { useSearchInput } from '../../hooks/useSearchInput.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { clamp } from '../../ink/layout/geometry.js';
import { Box, Text, useTerminalFocus } from '../../ink.js';
import { SearchBox } from '../SearchBox.js';
import { Byline } from './Byline.js';
import { KeyboardShortcutHint } from './KeyboardShortcutHint.js';
import { ListItem } from './ListItem.js';
import { Pane } from './Pane.js';
type PickerAction<T> = {
  /** Hint label shown in the byline, e.g. "mention" → "Tab to mention". */
  action: string;
  handler: (item: T) => void;
};
type Props<T> = {
  title: string;
  placeholder?: string;
  initialQuery?: string;
  items: readonly T[];
  getKey: (item: T) => string;
  /** Keep to one line — preview handles overflow. */
  renderItem: (item: T, isFocused: boolean) => React.ReactNode;
  renderPreview?: (item: T) => React.ReactNode;
  /** 'right' keeps hints stable (no bounce), but needs width. */
  previewPosition?: 'bottom' | 'right';
  visibleCount?: number;
  /**
   * 'up' puts items[0] at the bottom next to the input (atuin-style). Arrows
   * always match screen direction — ↑ walks visually up regardless.
   */
  direction?: 'down' | 'up';
  /** Caller owns filtering: re-filter on each call and pass new items. */
  onQueryChange: (query: string) => void;
  /** Enter key. Primary action. */
  onSelect: (item: T) => void;
  /**
   * Tab key. If provided, Tab no longer aliases Enter — it gets its own
   * handler and hint. Shift+Tab falls through to this if onShiftTab is unset.
   */
  onTab?: PickerAction<T>;
  /** Shift+Tab key. Gets its own hint. */
  onShiftTab?: PickerAction<T>;
  /**
   * Fires when the focused item changes (via arrows or when items reset).
   * Useful for async preview loading — keeps I/O out of renderPreview.
   */
  onFocus?: (item: T | undefined) => void;
  onCancel: () => void;
  /** Shown when items is empty. Caller bakes loading/searching state into this. */
  emptyMessage?: string | ((query: string) => string);
  /**
   * Status line below the list, e.g. "500+ matches" or "42 matches…".
   * Caller decides when to show it — pass undefined to hide.
   */
  matchLabel?: string;
  selectAction?: string;
  extraHints?: React.ReactNode;
};
const DEFAULT_VISIBLE = 8;
// Pane (paddingTop + Divider) + title + 3 gaps + SearchBox (rounded border = 3
// rows) + hints. matchLabel adds +1 when present, accounted for separately.
const CHROME_ROWS = 10;
const MIN_VISIBLE = 2;
export function FuzzyPicker<T>({
  title,
  placeholder = 'Type to search…',
  initialQuery,
  items,
  getKey,
  renderItem,
  renderPreview,
  previewPosition = 'bottom',
  visibleCount: requestedVisible = DEFAULT_VISIBLE,
  direction = 'down',
  onQueryChange,
  onSelect,
  onTab,
  onShiftTab,
  onFocus,
  onCancel,
  emptyMessage = 'No results',
  matchLabel,
  selectAction = 'select',
  extraHints
}: Props<T>): React.ReactNode {
  const isTerminalFocused = useTerminalFocus();
  const {
    rows,
    columns
  } = useTerminalSize();
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Cap visibleCount so the picker never exceeds the terminal height. When it
  // overflows, each re-render (arrow key, ctrl+p) mis-positions the cursor-up
  // by the overflow amount and a previously-drawn line flashes blank.
  const visibleCount = Math.max(MIN_VISIBLE, Math.min(requestedVisible, rows - CHROME_ROWS - (matchLabel ? 1 : 0)));

  // Full hint row with onTab+onShiftTab is ~100 chars and wraps inconsistently
  // below that. Compact mode drops shift+tab and shortens labels.
  const compact = columns < 120;
  const step = (delta: 1 | -1) => {
    setFocusedIndex(i => clamp(i + delta, 0, items.length - 1));
  };

  // onKeyDown fires after useSearchInput's useInput, so onExit must be a
  // no-op — return/downArrow are handled by handleKeyDown below. onCancel
  // still covers escape/ctrl+c/ctrl+d. Backspace-on-empty is disabled so
  // a held backspace doesn't eject the user from the dialog.
  const {
    query,
    cursorOffset
  } = useSearchInput({
    isActive: true,
    onExit: () => {},
    onCancel,
    initialQuery,
    backspaceExitsOnEmpty: false
  });
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'up' || e.ctrl && e.key === 'p') {
      e.preventDefault();
      e.stopImmediatePropagation();
      step(direction === 'up' ? 1 : -1);
      return;
    }
    if (e.key === 'down' || e.ctrl && e.key === 'n') {
      e.preventDefault();
      e.stopImmediatePropagation();
      step(direction === 'up' ? -1 : 1);
      return;
    }
    if (e.key === 'return') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const selected = items[focusedIndex];
      if (selected) onSelect(selected);
      return;
    }
    if (e.key === 'tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const selected = items[focusedIndex];
      if (!selected) return;
      const tabAction = e.shift ? onShiftTab ?? onTab : onTab;
      if (tabAction) {
        tabAction.handler(selected);
      } else {
        onSelect(selected);
      }
    }
  };
  useEffect(() => {
    onQueryChange(query);
    setFocusedIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useEffect(() => {
    setFocusedIndex(i => clamp(i, 0, items.length - 1));
  }, [items.length]);
  const focused = items[focusedIndex];
  useEffect(() => {
    onFocus?.(focused);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);
  const windowStart = clamp(focusedIndex - visibleCount + 1, 0, items.length - visibleCount);
  const visible = items.slice(windowStart, windowStart + visibleCount);
  const emptyText = typeof emptyMessage === 'function' ? emptyMessage(query) : emptyMessage;
  const searchBox = <SearchBox query={query} cursorOffset={cursorOffset} placeholder={placeholder} isFocused isTerminalFocused={isTerminalFocused} />;
  const listBlock = <List visible={visible} windowStart={windowStart} visibleCount={visibleCount} total={items.length} focusedIndex={focusedIndex} direction={direction} getKey={getKey} renderItem={renderItem} emptyText={emptyText} />;
  const preview = renderPreview && focused ? <Box flexDirection="column" flexGrow={1}>
        {renderPreview(focused)}
      </Box> : null;

  // Structure must not depend on preview truthiness — when focused goes
  // undefined (e.g. delete clears matches), switching row→fragment would
  // change both layout AND gap count, bouncing the searchBox below.
  const listGroup = renderPreview && previewPosition === 'right' ? <Box flexDirection="row" gap={2} height={visibleCount + (matchLabel ? 1 : 0)}>
        <Box flexDirection="column" flexShrink={0}>
          {listBlock}
          {matchLabel && <Text dimColor>{matchLabel}</Text>}
        </Box>
        {preview ?? <Box flexGrow={1} />}
      </Box> :
  // Box (not fragment) so the outer gap={1} doesn't insert a blank line
  // between list/matchLabel/preview — that read as extra space above the
  // prompt in direction='up'.
  <Box flexDirection="column">
        {listBlock}
        {matchLabel && <Text dimColor>{matchLabel}</Text>}
        {preview}
      </Box>;
  const inputAbove = direction !== 'up';
  return <Pane color="permission">
      <Box flexDirection="column" gap={1} tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
        <Text bold color="permission">
          {title}
        </Text>
        {inputAbove && searchBox}
        {listGroup}
        {!inputAbove && searchBox}
        <Text dimColor>
          <Byline>
            <KeyboardShortcutHint shortcut="↑/↓" action={compact ? 'nav' : 'navigate'} />
            <KeyboardShortcutHint shortcut="Enter" action={compact ? firstWord(selectAction) : selectAction} />
            {onTab && <KeyboardShortcutHint shortcut="Tab" action={onTab.action} />}
            {onShiftTab && !compact && <KeyboardShortcutHint shortcut="shift+tab" action={onShiftTab.action} />}
            <KeyboardShortcutHint shortcut="Esc" action="cancel" />
            {extraHints}
          </Byline>
        </Text>
      </Box>
    </Pane>;
}
type ListProps<T> = Pick<Props<T>, 'visibleCount' | 'direction' | 'getKey' | 'renderItem'> & {
  visible: readonly T[];
  windowStart: number;
  total: number;
  focusedIndex: number;
  emptyText: string;
};
function List(t0) {
  const $ = _c(27);
  const {
    visible,
    windowStart,
    visibleCount,
    total,
    focusedIndex,
    direction,
    getKey,
    renderItem,
    emptyText
  } = t0;
  if (visible.length === 0) {
    let t1;
    if ($[0] !== emptyText) {
      t1 = <Text dimColor={true}>{emptyText}</Text>;
      $[0] = emptyText;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    let t2;
    if ($[2] !== t1 || $[3] !== visibleCount) {
      t2 = <Box height={visibleCount} flexShrink={0}>{t1}</Box>;
      $[2] = t1;
      $[3] = visibleCount;
      $[4] = t2;
    } else {
      t2 = $[4];
    }
    return t2;
  }
  let t1;
  if ($[5] !== direction || $[6] !== focusedIndex || $[7] !== getKey || $[8] !== renderItem || $[9] !== total || $[10] !== visible || $[11] !== visibleCount || $[12] !== windowStart) {
    let t2;
    if ($[14] !== direction || $[15] !== focusedIndex || $[16] !== getKey || $[17] !== renderItem || $[18] !== total || $[19] !== visible.length || $[20] !== visibleCount || $[21] !== windowStart) {
      t2 = (item, i) => {
        const actualIndex = windowStart + i;
        const isFocused = actualIndex === focusedIndex;
        const atLowEdge = i === 0 && windowStart > 0;
        const atHighEdge = i === visible.length - 1 && windowStart + visibleCount < total;
        return <ListItem key={getKey(item)} isFocused={isFocused} showScrollUp={direction === "up" ? atHighEdge : atLowEdge} showScrollDown={direction === "up" ? atLowEdge : atHighEdge} styled={false}>{renderItem(item, isFocused)}</ListItem>;
      };
      $[14] = direction;
      $[15] = focusedIndex;
      $[16] = getKey;
      $[17] = renderItem;
      $[18] = total;
      $[19] = visible.length;
      $[20] = visibleCount;
      $[21] = windowStart;
      $[22] = t2;
    } else {
      t2 = $[22];
    }
    t1 = visible.map(t2);
    $[5] = direction;
    $[6] = focusedIndex;
    $[7] = getKey;
    $[8] = renderItem;
    $[9] = total;
    $[10] = visible;
    $[11] = visibleCount;
    $[12] = windowStart;
    $[13] = t1;
  } else {
    t1 = $[13];
  }
  const rows = t1;
  const t2 = direction === "up" ? "column-reverse" : "column";
  let t3;
  if ($[23] !== rows || $[24] !== t2 || $[25] !== visibleCount) {
    t3 = <Box height={visibleCount} flexShrink={0} flexDirection={t2}>{rows}</Box>;
    $[23] = rows;
    $[24] = t2;
    $[25] = visibleCount;
    $[26] = t3;
  } else {
    t3 = $[26];
  }
  return t3;
}
function firstWord(s: string): string {
  const i = s.indexOf(' ');
  return i === -1 ? s : s.slice(0, i);
}
