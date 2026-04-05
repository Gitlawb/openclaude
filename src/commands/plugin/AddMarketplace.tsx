import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { Byline } from '../../components/design-system/Byline.js';
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js';
import { Spinner } from '../../components/Spinner.js';
import TextInput from '../../components/TextInput.js';
import { Box, Text } from '../../ink.js';
import { toError } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import { clearAllCaches } from '../../utils/plugins/cacheUtils.js';
import { addMarketplaceSource, saveMarketplaceToSettings } from '../../utils/plugins/marketplaceManager.js';
import { parseMarketplaceInput } from '../../utils/plugins/parseMarketplaceInput.js';
import type { ViewState } from './types.js';
type Props = {
  inputValue: string;
  setInputValue: (value: string) => void;
  cursorOffset: number;
  setCursorOffset: (offset: number) => void;
  error: string | null;
  setError: (error: string | null) => void;
  result: string | null;
  setResult: (result: string | null) => void;
  setViewState: (state: ViewState) => void;
  onAddComplete?: () => void | Promise<void>;
  cliMode?: boolean;
};
export function AddMarketplace({
  inputValue,
  setInputValue,
  cursorOffset,
  setCursorOffset,
  error,
  setError,
  result,
  setResult,
  setViewState,
  onAddComplete,
  cliMode = false
}: Props): React.ReactNode {
  const hasAttemptedAutoAdd = useRef(false);
  const [isLoading, setLoading] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const handleAdd = async () => {
    const input = inputValue.trim();
    if (!input) {
      setError('Please enter a marketplace source');
      return;
    }
    const parsed = await parseMarketplaceInput(input);
    if (!parsed) {
      setError('Invalid marketplace source format. Try: owner/repo, https://..., or ./path');
      return;
    }

    // Check if parseMarketplaceInput returned an error
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    try {
      setLoading(true);
      setProgressMessage('');
      const {
        name,
        resolvedSource
      } = await addMarketplaceSource(parsed, message => {
        setProgressMessage(message);
      });
      saveMarketplaceToSettings(name, {
        source: resolvedSource
      });
      clearAllCaches();
      let sourceType = parsed.source;
      if (parsed.source === 'github') {
        sourceType = parsed.repo as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
      }
      logEvent('tengu_marketplace_added', {
        source_type: sourceType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      if (onAddComplete) {
        await onAddComplete();
      }
      setProgressMessage('');
      setLoading(false);
      if (cliMode) {
        // In CLI mode, set result to trigger completion
        setResult(`Successfully added marketplace: ${name}`);
      } else {
        // In interactive mode, switch to browse view
        setViewState({
          type: 'browse-marketplace',
          targetMarketplace: name
        });
      }
    } catch (err) {
      const error = toError(err);
      logError(error);
      setError(error.message);
      setProgressMessage('');
      setLoading(false);
      if (cliMode) {
        // In CLI mode, set result with error to trigger completion
        setResult(`Error: ${error.message}`);
      } else {
        setResult(null);
      }
    }
  };

  // Auto-add if inputValue is provided
  useEffect(() => {
    if (inputValue && !hasAttemptedAutoAdd.current && !error && !result) {
      hasAttemptedAutoAdd.current = true;
      void handleAdd();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  }, []); // Only run once on mount

  return <Box flexDirection="column">
      <Box flexDirection="column" paddingX={1} borderStyle="round">
        <Box marginBottom={1}>
          <Text bold>Add Marketplace</Text>
        </Box>
        <Box flexDirection="column">
          <Text>Enter marketplace source:</Text>
          <Text dimColor>Examples:</Text>
          <Text dimColor> · owner/repo (GitHub)</Text>
          <Text dimColor> · git@github.com:owner/repo.git (SSH)</Text>
          <Text dimColor> · https://example.com/marketplace.json</Text>
          <Text dimColor> · ./path/to/marketplace</Text>
          <Box marginTop={1}>
            <TextInput value={inputValue} onChange={setInputValue} onSubmit={handleAdd} columns={80} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} focus showCursor />
          </Box>
        </Box>
        {isLoading && <Box marginTop={1}>
            <Spinner />
            <Text>
              {progressMessage || 'Adding marketplace to configuration…'}
            </Text>
          </Box>}
        {error && <Box marginTop={1}>
            <Text color="error">{error}</Text>
          </Box>}
        {result && <Box marginTop={1}>
            <Text>{result}</Text>
          </Box>}
      </Box>
      <Box marginLeft={3}>
        <Text dimColor italic>
          <Byline>
            <KeyboardShortcutHint shortcut="Enter" action="add" />
            <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />
          </Byline>
        </Text>
      </Box>
    </Box>;
}
