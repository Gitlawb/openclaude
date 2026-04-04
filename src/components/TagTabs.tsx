import React from 'react';
import { stringWidth } from '../ink/stringWidth.js';
import { Box, Text } from '../ink.js';
import { truncateToWidth } from '../utils/format.js';

// Constants for width calculations - derived from actual rendered strings
const ALL_TAB_LABEL = 'All';
const TAB_PADDING = 2; // Space before and after tab text: " {tab} "
const HASH_PREFIX_LENGTH = 1; // "#" prefix for non-All tabs
const LEFT_ARROW_PREFIX = '← ';
const RIGHT_HINT_WITH_COUNT_PREFIX = '→';
const RIGHT_HINT_SUFFIX = ' (tab to cycle)';
const RIGHT_HINT_NO_COUNT = '(tab to cycle)';
const MAX_OVERFLOW_DIGITS = 2; // Assume max 99 hidden tabs for width calculation

// Computed widths
const LEFT_ARROW_WIDTH = LEFT_ARROW_PREFIX.length + MAX_OVERFLOW_DIGITS + 1; // "← NN " with gap
const RIGHT_HINT_WIDTH_WITH_COUNT = RIGHT_HINT_WITH_COUNT_PREFIX.length + MAX_OVERFLOW_DIGITS + RIGHT_HINT_SUFFIX.length; // "→NN (tab to cycle)"
const RIGHT_HINT_WIDTH_NO_COUNT = RIGHT_HINT_NO_COUNT.length;
type Props = {
  tabs: string[];
  selectedIndex: number;
  availableWidth: number;
  showAllProjects?: boolean;
};

/**
 * Calculate the display width of a tab
 */
function getTabWidth(tab: string, maxWidth?: number): number {
  if (tab === ALL_TAB_LABEL) {
    return ALL_TAB_LABEL.length + TAB_PADDING;
  }
  // For non-All tabs: " #{tag} " but truncate tag if needed
  const tagWidth = stringWidth(tab);
  const effectiveTagWidth = maxWidth ? Math.min(tagWidth, maxWidth - TAB_PADDING - HASH_PREFIX_LENGTH) : tagWidth;
  return Math.max(0, effectiveTagWidth) + TAB_PADDING + HASH_PREFIX_LENGTH;
}

/**
 * Truncate a tag to fit within maxWidth, accounting for padding and hash prefix
 */
function truncateTag(tag: string, maxWidth: number): string {
  // Available space for the tag text itself: maxWidth - " #" - " "
  const availableForTag = maxWidth - TAB_PADDING - HASH_PREFIX_LENGTH;
  if (stringWidth(tag) <= availableForTag) {
    return tag;
  }
  if (availableForTag <= 1) {
    return tag.charAt(0);
  }
  return truncateToWidth(tag, availableForTag);
}
export function TagTabs({
  tabs,
  selectedIndex,
  availableWidth,
  showAllProjects = false
}: Props): React.ReactNode {
  const resumeLabel = showAllProjects ? 'Resume (All Projects)' : 'Resume';
  const resumeLabelWidth = resumeLabel.length + 1; // +1 for gap

  // Calculate how much space we have for tabs (use worst-case hint width)
  const rightHintWidth = Math.max(RIGHT_HINT_WIDTH_WITH_COUNT, RIGHT_HINT_WIDTH_NO_COUNT);
  const maxTabsWidth = availableWidth - resumeLabelWidth - rightHintWidth - 2; // 2 for gaps

  // Clamp selectedIndex to valid range
  const safeSelectedIndex = Math.max(0, Math.min(selectedIndex, tabs.length - 1));

  // Calculate width of each tab, with truncation for very long tags
  const maxSingleTabWidth = Math.max(20, Math.floor(maxTabsWidth / 2)); // At least show half the space for one tab
  const tabWidths = tabs.map(tab => getTabWidth(tab, maxSingleTabWidth));

  // Find a window of tabs that fits, centered around selectedIndex
  let startIndex = 0;
  let endIndex = tabs.length;

  // Calculate total width of all tabs
  const totalTabsWidth = tabWidths.reduce((sum, w, i) => sum + w + (i < tabWidths.length - 1 ? 1 : 0), 0); // +1 for gaps between tabs

  if (totalTabsWidth > maxTabsWidth) {
    // Need to show a subset - account for left arrow when not at start
    const effectiveMaxWidth = maxTabsWidth - LEFT_ARROW_WIDTH;

    // Start with the selected tab
    let windowWidth = tabWidths[safeSelectedIndex] ?? 0;
    startIndex = safeSelectedIndex;
    endIndex = safeSelectedIndex + 1;

    // Expand window to include more tabs
    while (startIndex > 0 || endIndex < tabs.length) {
      const canExpandLeft = startIndex > 0;
      const canExpandRight = endIndex < tabs.length;
      if (canExpandLeft) {
        const leftWidth = (tabWidths[startIndex - 1] ?? 0) + 1; // +1 for gap
        if (windowWidth + leftWidth <= effectiveMaxWidth) {
          startIndex--;
          windowWidth += leftWidth;
          continue;
        }
      }
      if (canExpandRight) {
        const rightWidth = (tabWidths[endIndex] ?? 0) + 1; // +1 for gap
        if (windowWidth + rightWidth <= effectiveMaxWidth) {
          endIndex++;
          windowWidth += rightWidth;
          continue;
        }
      }
      break;
    }
  }
  const hiddenLeft = startIndex;
  const hiddenRight = tabs.length - endIndex;
  const visibleTabs = tabs.slice(startIndex, endIndex);
  const visibleIndices = visibleTabs.map((_, i_0) => startIndex + i_0);
  return <Box flexDirection="row" gap={1}>
      <Text color="suggestion">{resumeLabel}</Text>
      {hiddenLeft > 0 && <Text dimColor>
          {LEFT_ARROW_PREFIX}
          {hiddenLeft}
        </Text>}
      {visibleTabs.map((tab_0, i_1) => {
      const actualIndex = visibleIndices[i_1]!;
      const isSelected = actualIndex === safeSelectedIndex;
      const displayText = tab_0 === ALL_TAB_LABEL ? tab_0 : `#${truncateTag(tab_0, maxSingleTabWidth - TAB_PADDING)}`;
      return <Text key={tab_0} backgroundColor={isSelected ? 'suggestion' : undefined} color={isSelected ? 'inverseText' : undefined} bold={isSelected}>
            {' '}
            {displayText}{' '}
          </Text>;
    })}
      {hiddenRight > 0 ? <Text dimColor>
          {RIGHT_HINT_WITH_COUNT_PREFIX}
          {hiddenRight}
          {RIGHT_HINT_SUFFIX}
        </Text> : <Text dimColor>{RIGHT_HINT_NO_COUNT}</Text>}
    </Box>;
}
