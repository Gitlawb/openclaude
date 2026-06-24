import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { Box, Text, useInput } from '../../ink.js';
import { SessionSummary } from '../../components/SessionSummary.js';
import type { ReplayIndex, ReplayStep, ReplayToolStep, ReplayUserStep, ReplayRetryStep, ReplayErrorStep } from '../../types/logs.js';
import { formatReplayDuration } from '../../utils/replayFormat.js';

function getStepIcon(step: ReplayStep): string {
  switch (step.type) {
    case 'tool':
      switch (step.resultStatus) {
        case 'success': return '✅'
        case 'error': return '❌'
        case 'cancelled': return '⚠️'
        case 'permission_denied': return '🚫'
        default: return '•'
      }
    case 'user': return '👤'
    case 'retry': return '↻'
    case 'error': return '💥'
    default: return '•'
  }
}

function getStepColor(step: ReplayStep): string {
  switch (step.type) {
    case 'tool':
      switch (step.resultStatus) {
        case 'success': return 'green'
        case 'error': return 'red'
        case 'cancelled': return 'yellow'
        case 'permission_denied': return 'red'
        default: return 'white'
      }
    case 'user': return 'cyan'
    case 'retry': return 'yellow'
    case 'error': return 'red'
    default: return 'white'
  }
}

function ReplayStepRow({ step, isSelected }: {
  step: ReplayStep; 
  isSelected: boolean; 
}) {
  const icon = getStepIcon(step)
  const color = getStepColor(step)

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}>{icon}</Text>
        <Text bold> Step {step.stepNumber}: </Text>
        {step.type === 'tool' && (
          <>
            <Text>{(step as ReplayToolStep).inputSummary}</Text>
            <Text color="gray"> ({formatReplayDuration((step as ReplayToolStep).durationMs)})</Text>
            {((step as ReplayToolStep).repeatedAttemptNumber ?? 1) > 1 && (
              <Text color="yellow"> repeat {(step as ReplayToolStep).repeatedAttemptNumber}</Text>
            )}
          </>
        )}
        {step.type === 'user' && (
          <Text>{(step as ReplayUserStep).content.slice(0, 80)}{(step as ReplayUserStep).content.length > 80 ? '...' : ''}</Text>
        )}
        {step.type === 'error' && (
          <Text color="red">{(step as ReplayErrorStep).error.slice(0, 80)}</Text>
        )}
        {step.type === 'retry' && (
          <>
            <Text color="yellow">{(step as ReplayRetryStep).retryType} retry</Text>
            {(step as ReplayRetryStep).attempt !== undefined && (
              <Text color="gray"> attempt {(step as ReplayRetryStep).attempt}/{(step as ReplayRetryStep).maxRetries ?? '?'}</Text>
            )}
          </>
        )}
      </Box>
      {isSelected && step.type === 'tool' && (
        <Box marginLeft={4} flexDirection="column">
          {(step as ReplayToolStep).resultPreview && (
            <Text dimColor>Result: {(step as ReplayToolStep).resultPreview}</Text>
          )}
          {((step as ReplayToolStep).filesModified?.length ?? 0) > 0 && (
            <>
              <Text dimColor>Files modified:</Text>
              {(step as ReplayToolStep).filesModified?.map(file => (
                <Text key={file} dimColor>  {file}</Text>
              ))}
            </>
          )}
          {((step as ReplayToolStep).repeatedAttemptNumber ?? 1) > 1 && (
            <Text dimColor>Repeated attempt: {(step as ReplayToolStep).repeatedAttemptNumber}</Text>
          )}
        </Box>
      )}
      {isSelected && step.type === 'retry' && (
        <Box marginLeft={4} flexDirection="column">
          <Text dimColor>Reason: {(step as ReplayRetryStep).reason}</Text>
          {(step as ReplayRetryStep).retryDelayMs !== undefined && (
            <Text dimColor>Delay: {formatReplayDuration((step as ReplayRetryStep).retryDelayMs ?? 0)}</Text>
          )}
          {((step as ReplayRetryStep).commands?.length ?? 0) > 0 && (
            <Text dimColor>Commands: {(step as ReplayRetryStep).commands?.join(', ')}</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

export function ReplayTimeline({
  index,
  onExit,
}: {
  index: ReplayIndex;
  onExit?: () => void;
}) {
  const [selectedStep, setSelectedStep] = React.useState<number | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  const displaySteps = showAll ? index.steps : index.steps.slice(-20);
  const selectedIndex = displaySteps.findIndex(step => step.stepNumber === selectedStep);

  useInput((input, key) => {
    if (key.escape || input === 'q' || (key.ctrl && input === 'c')) {
      onExit?.();
      return;
    }

    if (input === 'a' && index.steps.length > 20) {
      setShowAll(true);
      return;
    }

    if (displaySteps.length === 0) return;

    if (key.upArrow) {
      const nextIndex = selectedIndex > 0 ? selectedIndex - 1 : displaySteps.length - 1;
      setSelectedStep(displaySteps[nextIndex]?.stepNumber ?? null);
    } else if (key.downArrow) {
      const nextIndex = selectedIndex >= 0 && selectedIndex < displaySteps.length - 1 ? selectedIndex + 1 : 0;
      setSelectedStep(displaySteps[nextIndex]?.stepNumber ?? null);
    } else if (key.return) {
      if (selectedIndex >= 0) {
        setSelectedStep(null);
      } else {
        setSelectedStep(displaySteps[0]?.stepNumber ?? null);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <SessionSummary summary={index.summary} />
      
      <Box flexDirection="column">
        {displaySteps.map((step) => (
          <ReplayStepRow
            key={step.stepNumber}
            step={step}
            isSelected={selectedStep === step.stepNumber}
          />
        ))}
      </Box>

      {index.steps.length > 20 && !showAll && (
        <Box marginTop={1}>
          <Text dimColor>
            Showing last 20 of {index.steps.length} steps. Press 'a' to show all.
          </Text>
        </Box>
      )}
    </Box>
  );
}
