import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useRegisterOverlay } from '../context/overlayContext.js';
import { getTimestampedHistory, type TimestampedHistoryEntry } from '../history.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { stringWidth } from '../ink/stringWidth.js';
import { wrapAnsi } from '../ink/wrapAnsi.js';
import { Box, Text } from '../ink.js';
import { logEvent } from '../services/analytics/index.js';
import type { HistoryEntry } from '../utils/config.js';
import { formatRelativeTimeAgo, truncateToWidth } from '../utils/format.js';
import { FuzzyPicker } from './design-system/FuzzyPicker.js';
type Props = {
  initialQuery?: string;
  onSelect: (entry: HistoryEntry) => void;
  onCancel: () => void;
};
const PREVIEW_ROWS = 6;
const AGE_WIDTH = 8;
type Item = {
  entry: TimestampedHistoryEntry;
  display: string;
  lower: string;
  firstLine: string;
  age: string;
};
export function HistorySearchDialog({
  initialQuery,
  onSelect,
  onCancel
}: Props): React.ReactNode {
  // @ts-expect-error wrong number of arguments
  useRegisterOverlay('history-search');
  const {
    columns
  } = useTerminalSize();
  const [items, setItems] = useState<Item[] | null>(null);
  const [query, setQuery] = useState(initialQuery ?? '');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const reader = getTimestampedHistory();
      const loaded: Item[] = [];
      for await (const entry of reader) {
        if (cancelled) {
          void reader.return(undefined);
          return;
        }
        const display = entry.display;
        const nl = display.indexOf('\n');
        const age = formatRelativeTimeAgo(new Date(entry.timestamp));
        loaded.push({
          entry,
          display,
          lower: display.toLowerCase(),
          firstLine: nl === -1 ? display : display.slice(0, nl),
          age: age + ' '.repeat(Math.max(0, AGE_WIDTH - stringWidth(age)))
        });
      }
      if (!cancelled) setItems(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const exact: Item[] = [];
    const fuzzy: Item[] = [];
    for (const item of items) {
      if (item.lower.includes(q)) {
        exact.push(item);
      } else if (isSubsequence(item.lower, q)) {
        fuzzy.push(item);
      }
    }
    return exact.concat(fuzzy);
  }, [items, query]);
  const previewOnRight = columns >= 100;
  const listWidth = previewOnRight ? Math.floor((columns - 6) * 0.5) : columns - 6;
  const rowWidth = Math.max(20, listWidth - AGE_WIDTH - 1);
  const previewWidth = previewOnRight ? Math.max(20, columns - listWidth - 12) : Math.max(20, columns - 10);
  return <FuzzyPicker title="Search prompts" placeholder="Filter history…" initialQuery={initialQuery} items={filtered} getKey={item_0 => String(item_0.entry.timestamp)} onQueryChange={setQuery} onSelect={item_1 => {
    logEvent('tengu_history_picker_select', {
      result_count: filtered.length,
      query_length: query.length
    });
    void item_1.entry.resolve().then(onSelect);
  }} onCancel={onCancel} emptyMessage={q_0 => items === null ? 'Loading…' : q_0 ? 'No matching prompts' : 'No history yet'} selectAction="use" direction="up" previewPosition={previewOnRight ? 'right' : 'bottom'} renderItem={(item_2, isFocused) => <Text>
          <Text dimColor>{item_2.age}</Text>
          <Text color={isFocused ? 'suggestion' : undefined}>
            {' '}
            {truncateToWidth(item_2.firstLine, rowWidth)}
          </Text>
        </Text>} renderPreview={item_3 => {
    const wrapped = wrapAnsi(item_3.display, previewWidth, {
      hard: true
    }).split('\n').filter(l => l.trim() !== '');
    const overflow = wrapped.length > PREVIEW_ROWS;
    const shown = wrapped.slice(0, overflow ? PREVIEW_ROWS - 1 : PREVIEW_ROWS);
    const more = wrapped.length - shown.length;
    return <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} height={PREVIEW_ROWS + 2}>
            {shown.map((row, i) => <Text key={i} dimColor>
                {row}
              </Text>)}
            {more > 0 && <Text dimColor>{`… +${more} more lines`}</Text>}
          </Box>;
  }} />;
}
function isSubsequence(text: string, query: string): boolean {
  let j = 0;
  for (let i = 0; i < text.length && j < query.length; i++) {
    if (text[i] === query[j]) j++;
  }
  return j === query.length;
}
