import { join } from 'path';
import React, { useCallback, useState } from 'react';
import type { ExitState } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { setClipboard } from '../ink/termio/osc.js';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { getCwd } from '../utils/cwd.js';
import { writeFileSync_DEPRECATED } from '../utils/slowOperations.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/select.js';
import { Byline } from './design-system/Byline.js';
import { Dialog } from './design-system/Dialog.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import TextInput from './TextInput.js';
type ExportDialogProps = {
  content: string;
  defaultFilename: string;
  onDone: (result: {
    success: boolean;
    message: string;
  }) => void;
};
type ExportOption = 'clipboard' | 'file';
export function ExportDialog({
  content,
  defaultFilename,
  onDone
}: ExportDialogProps): React.ReactNode {
  const [, setSelectedOption] = useState<ExportOption | null>(null);
  const [filename, setFilename] = useState<string>(defaultFilename);
  const [cursorOffset, setCursorOffset] = useState<number>(defaultFilename.length);
  const [showFilenameInput, setShowFilenameInput] = useState(false);
  const {
    columns
  } = useTerminalSize();

  // Handle going back from filename input to option selection
  const handleGoBack = useCallback(() => {
    setShowFilenameInput(false);
    setSelectedOption(null);
  }, []);
  const handleSelectOption = async (value: string): Promise<void> => {
    if (value === 'clipboard') {
      // Copy to clipboard immediately
      const raw = await setClipboard(content);
      if (raw) process.stdout.write(raw);
      onDone({
        success: true,
        message: 'Розмову скопійовано у буфер обміну'
      });
    } else if (value === 'file') {
      setSelectedOption('file');
      setShowFilenameInput(true);
    }
  };
  const handleFilenameSubmit = () => {
    const finalFilename = filename.endsWith('.txt') ? filename : filename.replace(/\.[^.]+$/, '') + '.txt';
    const filepath = join(getCwd(), finalFilename);
    try {
      writeFileSync_DEPRECATED(filepath, content, {
        encoding: 'utf-8',
        flush: true
      });
      onDone({
        success: true,
        message: `Розмову експортовано у: ${filepath}`
      });
    } catch (error) {
      onDone({
        success: false,
        message: `Не вдалося експортувати розмову: ${error instanceof Error ? error.message : 'Невідома помилка'}`
      });
    }
  };

  // Dialog calls onCancel when Escape is pressed. If we are in the filename
  // input sub-screen, go back to the option list instead of closing entirely.
  const handleCancel = useCallback(() => {
    if (showFilenameInput) {
      handleGoBack();
    } else {
      onDone({
        success: false,
        message: 'Експорт скасовано'
      });
    }
  }, [showFilenameInput, handleGoBack, onDone]);
  const options = [{
    label: 'Скопіювати у буфер обміну',
    value: 'clipboard',
    description: 'Скопіювати розмову у системний буфер обміну'
  }, {
    label: 'Зберегти у файл',
    value: 'file',
    description: 'Зберегти розмову у файл в поточній директорії'
  }];

  // Custom input guide that changes based on dialog state
  function renderInputGuide(exitState: ExitState): React.ReactNode {
    if (showFilenameInput) {
      return <Byline>
          <KeyboardShortcutHint shortcut="Enter" action="зберегти" />
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="назад" />
        </Byline>;
    }
    if (exitState.pending) {
      return <Text>Натисніть {exitState.keyName} ще раз для виходу</Text>;
    }
    return <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="скасувати" />;
  }

  // Use Settings context so 'n' key doesn't cancel (allows typing 'n' in filename input)
  useKeybinding('confirm:no', handleCancel, {
    context: 'Settings',
    isActive: showFilenameInput
  });
  return <Dialog title="Експорт розмови" subtitle="Оберіть спосіб експорту:" color="permission" onCancel={handleCancel} inputGuide={renderInputGuide} isCancelActive={!showFilenameInput}>
      {!showFilenameInput ? <Select options={options} onChange={handleSelectOption} onCancel={handleCancel} /> : <Box flexDirection="column">
          <Text>Введіть ім'я файлу:</Text>
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Text>&gt;</Text>
            <TextInput value={filename} onChange={setFilename} onSubmit={handleFilenameSubmit} focus={true} showCursor={true} columns={columns} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} />
          </Box>
        </Box>}
    </Dialog>;
}
