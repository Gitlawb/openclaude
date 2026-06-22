import { c as _c } from "react-compiler-runtime";
import chalk from 'chalk';
import * as React from 'react';
import { Box, Text } from '../ink.js';
import type { ReplaySummary } from '../types/logs.js';
import { formatReplayDuration } from '../utils/replayFormat.js';

function formatToolBreakdown(breakdown: Record<string, number>): string {
  return Object.entries(breakdown)
    .map(([tool, count]) => `${count} ${tool}`)
    .join(', ')
}

interface SessionSummaryProps {
  summary: ReplaySummary;
  compact?: boolean;
}

export function SessionSummary({ summary, compact = false }: SessionSummaryProps) {
  if (compact) {
    // Single line format
    const totalTools = Object.values(summary.toolBreakdown).reduce((a, b) => a + b, 0)
    return (
      <Box>
      <Text color="cyan">
          {summary.totalSteps} steps | {totalTools} tools | {summary.filesModified.length} files | {summary.retryAttempts ?? 0} retries | {summary.repeatedAttempts ?? 0} repeats | {formatReplayDuration(summary.durationMs)}
      </Text>
      </Box>
    );
  }

  // Full summary with breakdown
  return (
    <Box flexDirection="column" borderStyle="round" padding={1} marginBottom={1}>
      <Text bold>
        {chalk.cyan('Session Summary')}
      </Text>
      <Text>
        {chalk.gray('Duration:')} {formatReplayDuration(summary.durationMs)}
      </Text>
      <Text>
        {chalk.gray('Steps:')} {summary.totalSteps} ({summary.userRequests} user requests)
      </Text>
      <Text>
        {chalk.gray('Tools:')} {Object.keys(summary.toolBreakdown).length > 0 ? formatToolBreakdown(summary.toolBreakdown) : 'None'}
      </Text>
      <Text>
        {chalk.gray('Files modified:')} {summary.filesModified.length}
      </Text>
      <Text>
        {chalk.gray('Retries:')} {summary.retryAttempts ?? 0}
      </Text>
      <Text>
        {chalk.gray('Repeated attempts:')} {summary.repeatedAttempts ?? 0}
      </Text>
      {summary.filesModified.length > 0 && (
        <Box marginLeft={2} flexDirection="column">
          {summary.filesModified.slice(0, 5).map(file => (
            <Text key={file} dimColor>
              {file}
            </Text>
          ))}
          {summary.filesModified.length > 5 && (
            <Text dimColor>
              ...and {summary.filesModified.length - 5} more
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
