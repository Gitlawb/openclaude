import figures from 'figures';
import React, { useEffect, useState } from 'react';
import { Box, Text } from '../ink.js';
import { logForDebugging } from '../utils/debug.js';
import type { GitFileStatus } from '../utils/git.js';
import { getFileStatus, stashToCleanState } from '../utils/git.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
import { Spinner } from './Spinner.js';
type TeleportStashProps = {
  onStashAndContinue: () => void;
  onCancel: () => void;
};
export function TeleportStash({
  onStashAndContinue,
  onCancel
}: TeleportStashProps): React.ReactNode {
  const [gitFileStatus, setGitFileStatus] = useState<GitFileStatus | null>(null);
  const changedFiles = gitFileStatus !== null ? [...gitFileStatus.tracked, ...gitFileStatus.untracked] : [];
  const [loading, setLoading] = useState(true);
  const [stashing, setStashing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load changed files on mount
  useEffect(() => {
    const loadChangedFiles = async () => {
      try {
        const fileStatus = await getFileStatus();
        setGitFileStatus(fileStatus);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logForDebugging(`Error getting changed files: ${errorMessage}`, {
          level: 'error'
        });
        setError('Не вдалося отримати змінені файли');
      } finally {
        setLoading(false);
      }
    };
    void loadChangedFiles();
  }, []);
  const handleStash = async () => {
    setStashing(true);
    try {
      logForDebugging('Stashing changes before teleport...');
      const success = await stashToCleanState('Teleport auto-stash');
      if (success) {
        logForDebugging('Successfully stashed changes');
        onStashAndContinue();
      } else {
        setError('Не вдалося відкласти зміни');
      }
    } catch (err_0) {
      const errorMessage_0 = err_0 instanceof Error ? err_0.message : String(err_0);
      logForDebugging(`Error stashing changes: ${errorMessage_0}`, {
        level: 'error'
      });
      setError('Не вдалося відкласти зміни');
    } finally {
      setStashing(false);
    }
  };
  const handleSelectChange = (value: string) => {
    if (value === 'stash') {
      void handleStash();
    } else {
      onCancel();
    }
  };
  if (loading) {
    return <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Spinner />
          <Text> Перевірка git статусу{figures.ellipsis}</Text>
        </Box>
      </Box>;
  }
  if (error) {
    return <Box flexDirection="column" padding={1}>
        <Text bold color="error">
          Помилка: {error}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>Натисніть </Text>
          <Text bold>Escape</Text>
          <Text dimColor> для скасування</Text>
        </Box>
      </Box>;
  }
  const showFileCount = changedFiles.length > 8;
  return <Dialog title="У робочій директорії є зміни" onCancel={onCancel}>
      <Text>
        Teleport перемкне git гілки. Знайдено такі зміни:
      </Text>

      <Box flexDirection="column" paddingLeft={2}>
        {changedFiles.length > 0 ? showFileCount ? <Text>{changedFiles.length} файлів змінено</Text> : changedFiles.map((file: string, index: number) => <Text key={index}>{file}</Text>) : <Text dimColor>Змін не виявлено</Text>}
      </Box>

      <Text>
        Відкласти ці зміни й продовжити з teleport?
      </Text>

      {stashing ? <Box>
          <Spinner />
          <Text> Відкладаємо зміни...</Text>
        </Box> : <Select options={[{
      label: 'Відкласти зміни і продовжити',
      value: 'stash'
    }, {
      label: 'Вийти',
      value: 'exit'
    }]} onChange={handleSelectChange} />}
    </Dialog>;
}
