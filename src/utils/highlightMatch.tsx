import * as React from 'react';
import { Text } from '../ink.js';

/**
 * Inverse-highlight every occurrence of `query` in `text` (case-insensitive).
 * Used by search dialogs to show where the query matched in result rows
 * and preview panes.
 */
export function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let offset = 0;
  let idx = textLower.indexOf(queryLower, offset);
  if (idx === -1) return text;
  while (idx !== -1) {
    if (idx > offset) parts.push(text.slice(offset, idx));
    parts.push(<Text key={idx} inverse>
        {text.slice(idx, idx + query.length)}
      </Text>);
    offset = idx + query.length;
    idx = textLower.indexOf(queryLower, offset);
  }
  if (offset < text.length) parts.push(text.slice(offset));
  return <>{parts}</>;
}

/**
 * Bold the characters of `text` that a fuzzy query matched (case-insensitive).
 * Prefers a contiguous run; otherwise replays the greedy earliest-subsequence
 * scan the fuzzy matchers use. Bold (not inverse) so a focused row's
 * suggestion color stays visible. Returns `text` unchanged when the query
 * isn't a subsequence (e.g. the row matched on a different field).
 */
export function highlightFuzzyMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const idx = textLower.indexOf(queryLower);
  if (idx !== -1) {
    return <>
        {text.slice(0, idx)}
        <Text bold>{text.slice(idx, idx + query.length)}</Text>
        {text.slice(idx + query.length)}
      </>;
  }
  const matched: boolean[] = new Array(text.length).fill(false);
  let qi = 0;
  for (let ti = 0; ti < text.length && qi < queryLower.length; ti++) {
    if (textLower[ti] === queryLower[qi]) {
      matched[ti] = true;
      qi++;
    }
  }
  if (qi < queryLower.length) return text;
  const parts: React.ReactNode[] = [];
  let runStart = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || matched[i] !== matched[runStart]) {
      const segment = text.slice(runStart, i);
      parts.push(matched[runStart] ? <Text key={runStart} bold>
            {segment}
          </Text> : segment);
      runStart = i;
    }
  }
  return <>{parts}</>;
}
