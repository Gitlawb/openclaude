import React, { useCallback, useState } from 'react';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { type CodeSession, fetchCodeSessionsFromSessionsAPI } from 'src/utils/teleport/api.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw j/k/arrow list navigation
import { Box, Text, useInput } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { logForDebugging } from '../utils/debug.js';
import { detectCurrentRepository } from '../utils/detectRepository.js';
import { formatRelativeTime } from '../utils/format.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/index.js';
import { Byline } from './design-system/Byline.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { Spinner } from './Spinner.js';
import { TeleportError } from './TeleportError.js';
type Props = {
  onSelect: (session: CodeSession) => void;
  onCancel: () => void;
  isEmbedded?: boolean;
};
type LoadErrorType = 'network' | 'auth' | 'api' | 'other';
const UPDATED_STRING = 'Updated';
const SPACE_BETWEEN_TABLE_COLUMNS = '  ';
export function ResumeTask({
  onSelect,
  onCancel,
  isEmbedded = false
}: Props): React.ReactNode {
  const {
    rows
  } = useTerminalSize();
  const [sessions, setSessions] = useState<CodeSession[]>([]);
  const [currentRepo, setCurrentRepo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErrorType, setLoadErrorType] = useState<LoadErrorType | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [hasCompletedTeleportErrorFlow, setHasCompletedTeleportErrorFlow] = useState(false);

  // Track focused index for scroll position display in title
  const [focusedIndex, setFocusedIndex] = useState(1);
  const escKey = useShortcutDisplay('confirm:no', 'Confirmation', 'Esc');
  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      setLoadErrorType(null);

      // Detect current repository
      const detectedRepo = await detectCurrentRepository();
      setCurrentRepo(detectedRepo);
      logForDebugging(`Current repository: ${detectedRepo || 'not detected'}`);
      const codeSessions = await fetchCodeSessionsFromSessionsAPI();

      // Filter sessions by current repository if detected
      let filteredSessions = codeSessions;
      if (detectedRepo) {
        filteredSessions = codeSessions.filter(session => {
          if (!session.repo) return false;
          const sessionRepo = `${session.repo.owner.login}/${session.repo.name}`;
          return sessionRepo === detectedRepo;
        });
        logForDebugging(`Filtered ${filteredSessions.length} sessions for repo ${detectedRepo} from ${codeSessions.length} total`);
      }

      // Sort by updated_at (newest first)
      const sortedSessions = [...filteredSessions].sort((a, b) => {
        const dateA = new Date(a.updated_at);
        const dateB = new Date(b.updated_at);
        return dateB.getTime() - dateA.getTime();
      });
      setSessions(sortedSessions);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logForDebugging(`Error loading code sessions: ${errorMessage}`);
      setLoadErrorType(determineErrorType(errorMessage));
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, []);
  const handleRetry = () => {
    setRetrying(true);
    void loadSessions();
  };

  // Handle escape via keybinding
  useKeybinding('confirm:no', onCancel, {
    context: 'Confirmation'
  });
  useInput((input, key) => {
    // We need to handle ctrl+c in case we don't render a <Select>
    if (key.ctrl && input === 'c') {
      onCancel();
      return;
    }

    // Handle retry in error state with 'ctrl+r'
    if (key.ctrl && input === 'r' && loadErrorType) {
      handleRetry();
      return;
    }

    // Handle enter key for error states to allow continuation with regular teleport
    if (loadErrorType !== null && key.return) {
      onCancel(); // This will continue with regular teleport flow
      return;
    }
  });
  const handleErrorComplete = useCallback(() => {
    setHasCompletedTeleportErrorFlow(true);
    void loadSessions();
  }, [setHasCompletedTeleportErrorFlow, loadSessions]);

  // Show error dialog if needed
  if (!hasCompletedTeleportErrorFlow) {
    return <TeleportError onComplete={handleErrorComplete} />;
  }
  if (loading) {
    return <Box flexDirection="column" padding={1}>
        <Box flexDirection="row">
          <Spinner />
          <Text bold>Loading OpenClaude sessions…</Text>
        </Box>
        <Text dimColor>
          {retrying ? 'Retrying…' : 'Fetching your OpenClaude sessions…'}
        </Text>
      </Box>;
  }
  if (loadErrorType) {
    return <Box flexDirection="column" padding={1}>
        <Text bold color="error">
          Error loading OpenClaude sessions
        </Text>

        {renderErrorSpecificGuidance(loadErrorType)}

        <Text dimColor>
          Press <Text bold>Ctrl+R</Text> to retry · Press{' '}
          <Text bold>{escKey}</Text> to cancel
        </Text>
      </Box>;
  }
  if (sessions.length === 0) {
    return <Box flexDirection="column" padding={1}>
        <Text bold>
          No OpenClaude sessions found
          {currentRepo && <Text> for {currentRepo}</Text>}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            Press <Text bold>{escKey}</Text> to cancel
          </Text>
        </Box>
      </Box>;
  }
  const sessionMetadata = sessions.map(session_0 => ({
    ...session_0,
    timeString: formatRelativeTime(new Date(session_0.updated_at))
  }));
  const maxTimeStringLength = Math.max(UPDATED_STRING.length, ...sessionMetadata.map(meta => meta.timeString.length));
  const options = sessionMetadata.map(({
    timeString,
    title,
    id
  }) => {
    const paddedTime = timeString.padEnd(maxTimeStringLength, ' ');

    // TODO: include branch name when API returns it
    return {
      label: `${paddedTime}  ${title}`,
      value: id
    };
  });

  // Adjust layout for embedded vs full-screen rendering
  // Overhead: padding (2) + title (1) + marginY (2) + header (1) + footer (1) = 7
  const layoutOverhead = 7;
  const maxVisibleOptions = Math.max(1, isEmbedded ? Math.min(sessions.length, 5, rows - 6 - layoutOverhead) : Math.min(sessions.length, rows - 1 - layoutOverhead));
  const maxHeight = maxVisibleOptions + layoutOverhead;

  // Show scroll position in title when list needs scrolling
  const showScrollPosition = sessions.length > maxVisibleOptions;
  return <Box flexDirection="column" padding={1} height={maxHeight}>
      <Text bold>
        Select a session to resume
        {showScrollPosition && <Text dimColor>
            {' '}
            ({focusedIndex} of {sessions.length})
          </Text>}
        {currentRepo && <Text dimColor> ({currentRepo})</Text>}:
      </Text>
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        <Box marginLeft={2}>
          <Text bold>
            {UPDATED_STRING.padEnd(maxTimeStringLength, ' ')}
            {SPACE_BETWEEN_TABLE_COLUMNS}
            {'Session Title'}
          </Text>
        </Box>
        <Select visibleOptionCount={maxVisibleOptions} options={options} onChange={value => {
        const session_1 = sessions.find(s => s.id === value);
        if (session_1) {
          onSelect(session_1);
        }
      }} onFocus={value_0 => {
        const index = options.findIndex(o => o.value === value_0);
        if (index >= 0) {
          setFocusedIndex(index + 1);
        }
      }} />
      </Box>
      <Box flexDirection="row">
        <Text dimColor>
          <Byline>
            <KeyboardShortcutHint shortcut="↑/↓" action="select" />
            <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
          </Byline>
        </Text>
      </Box>
    </Box>;
}

/**
 * Determines the type of error based on the error message
 */
function determineErrorType(errorMessage: string): LoadErrorType {
  const message = errorMessage.toLowerCase();
  if (message.includes('fetch') || message.includes('network') || message.includes('timeout')) {
    return 'network';
  }
  if (message.includes('auth') || message.includes('token') || message.includes('permission') || message.includes('oauth') || message.includes('not authenticated') || message.includes('/login') || message.includes('console account') || message.includes('403')) {
    return 'auth';
  }
  if (message.includes('api') || message.includes('rate limit') || message.includes('500') || message.includes('529')) {
    return 'api';
  }
  return 'other';
}

/**
 * Renders error-specific troubleshooting guidance
 */
function renderErrorSpecificGuidance(errorType: LoadErrorType): React.ReactNode {
  switch (errorType) {
    case 'network':
      return <Box marginY={1} flexDirection="column">
          <Text dimColor>Check your internet connection</Text>
        </Box>;
    case 'auth':
      return <Box marginY={1} flexDirection="column">
          <Text dimColor>Teleport requires a Claude account</Text>
          <Text dimColor>
            Run <Text bold>/login</Text> and select &quot;Claude account with
            subscription&quot;
          </Text>
        </Box>;
    case 'api':
      return <Box marginY={1} flexDirection="column">
          <Text dimColor>Sorry, Claude encountered an error</Text>
        </Box>;
    case 'other':
      return <Box marginY={1} flexDirection="row">
          <Text dimColor>Sorry, OpenClaude encountered an error</Text>
        </Box>;
  }
}
