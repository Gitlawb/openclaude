import React, { useCallback, useRef, useState } from 'react';
import type { ExitState } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { setClipboard } from '../ink/termio/osc.js';
import { Box, Text, useInput } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { getCwd } from '../utils/cwd.js';
import type { ExportFormat } from '../utils/exportFormats.js';
import { ensureExportFilenameExtension, resolveExportFilepath } from '../utils/exportFormats.js';
import { writeFileSync_DEPRECATED } from '../utils/slowOperations.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/select.js';
import { Byline } from './design-system/Byline.js';
import { Dialog } from './design-system/Dialog.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import TextInput from './TextInput.js';
type ExportDialogProps = {
  defaultFilename: string;
  defaultFormat: ExportFormat;
  getContent: (format: ExportFormat) => Promise<string>;
  onDone: (result: {
    success: boolean;
    message: string;
  }) => void;
};
type DialogStep = 'format' | 'method' | 'filename';
export function ExportDialog({
  defaultFilename,
  defaultFormat,
  getContent,
  onDone
}: ExportDialogProps): React.ReactNode {
  const [step, setStep] = useState<DialogStep>('format');
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>(defaultFormat);
  const [isExporting, setIsExporting] = useState(false);
  const isExportingRef = useRef(false);
  const formatFilenames: Record<ExportFormat, string> = {
    text: ensureExportFilenameExtension(defaultFilename, 'text'),
    markdown: ensureExportFilenameExtension(defaultFilename, 'markdown', {
      preserveMarkdownExtension: true,
    }),
    json: ensureExportFilenameExtension(defaultFilename, 'json'),
  };
  const [filename, setFilename] = useState<string>(formatFilenames[defaultFormat]);
  const [cursorOffset, setCursorOffset] = useState<number>(formatFilenames[defaultFormat].length);
  const {
    columns
  } = useTerminalSize();

  // Handle going back through steps
  const handleGoBack = useCallback(() => {
    if (step === 'filename') {
      setStep('method');
    } else if (step === 'method') {
      setStep('format');
    }
  }, [step]);

  const handleSelectFormat = (value: string): void => {
    const format = value as ExportFormat;
    setSelectedFormat(format);
    const newFilename = ensureExportFilenameExtension(filename, format, {
      preserveMarkdownExtension: true,
    });
    setFilename(newFilename);
    setCursorOffset(newFilename.length);
    setStep('method');
  };

  const handleSelectOption = async (value: string): Promise<void> => {
    if (isExportingRef.current) return;
    if (value === 'clipboard') {
      isExportingRef.current = true;
      setIsExporting(true);
      try {
        const content = await getContent(selectedFormat);
        const raw = await setClipboard(content);
        if (raw) process.stdout.write(raw);
        onDone({
          success: true,
          message: 'Conversation copied to clipboard'
        });
      } catch (error) {
        isExportingRef.current = false;
        setIsExporting(false);
        onDone({
          success: false,
          message: `Failed to copy conversation: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    } else if (value === 'file') {
      setStep('filename');
    }
  };
  const handleFilenameSubmit = async () => {
    if (isExportingRef.current) return;
    isExportingRef.current = true;
    setIsExporting(true);
    const finalFilename = ensureExportFilenameExtension(filename, selectedFormat, {
      preserveMarkdownExtension: true,
    });
    const filepath = resolveExportFilepath(getCwd(), finalFilename);
    try {
      const content = await getContent(selectedFormat);
      writeFileSync_DEPRECATED(filepath, content, {
        encoding: 'utf-8',
        flush: true
      });
      onDone({
        success: true,
        message: `Conversation exported to: ${filepath}`
      });
    } catch (error) {
      isExportingRef.current = false;
      setIsExporting(false);
      onDone({
        success: false,
        message: `Failed to export conversation: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  };

  // Dialog calls onCancel when Escape is pressed.
  const handleCancel = useCallback(() => {
    if (isExportingRef.current) return;
    if (step !== 'format') {
      handleGoBack();
    } else {
      onDone({
        success: false,
        message: 'Export cancelled'
      });
    }
  }, [step, handleGoBack, onDone]);

  const formatOptions = [{
    label: 'Plain Text (.txt)',
    value: 'text',
    description: 'Plain text format'
  }, {
    label: 'Markdown (.md)',
    value: 'markdown',
    description: 'Markdown format for readable archives'
  }, {
    label: 'JSON (.json)',
    value: 'json',
    description: 'Structured JSON for programmatic use'
  }];

  const methodOptions = [{
    label: 'Copy to clipboard',
    value: 'clipboard',
    description: 'Copy the conversation to your system clipboard'
  }, {
    label: 'Save to file',
    value: 'file',
    description: `Save as ${selectedFormat} to a file in the current directory`
  }];

  // Custom input guide that changes based on dialog state
  function renderInputGuide(exitState: ExitState): React.ReactNode {
    if (step === 'filename') {
      return <Byline>
          <KeyboardShortcutHint shortcut="Enter" action="save" />
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" />
        </Byline>;
    }
    if (exitState.pending) {
      return <Text>Press {exitState.keyName} again to exit</Text>;
    }
    return <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description={step === 'format' ? 'cancel' : 'go back'} />;
  }

  // Use Settings context so 'n' key doesn't cancel (allows typing 'n' in filename input)
  useKeybinding('confirm:no', handleCancel, {
    context: 'Settings',
    isActive: step === 'filename'
  });
  useInput((_input, key, event) => {
    if (key.escape && !isExportingRef.current) {
      event.stopImmediatePropagation();
      handleCancel();
    }
  }, {
    isActive: step !== 'format'
  });
  return <Dialog title="Export Conversation" subtitle={step === 'format' ? 'Select export format:' : step === 'method' ? 'Select export method:' : 'Enter filename:'} color="permission" onCancel={handleCancel} inputGuide={renderInputGuide} isCancelActive={step !== 'filename'}>
      {step === 'format' && <Select options={formatOptions} defaultValue={selectedFormat} defaultFocusValue={selectedFormat} onChange={handleSelectFormat} onCancel={handleCancel} isDisabled={isExporting} />}
      {step === 'method' && <Select options={methodOptions} onChange={handleSelectOption} onCancel={handleCancel} isDisabled={isExporting} />}
      {step === 'filename' && <Box flexDirection="column">
          <Text>Enter filename:</Text>
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Text>&gt;</Text>
            <TextInput value={filename} onChange={isExporting ? () => {} : setFilename} onSubmit={handleFilenameSubmit} onExit={handleCancel} disableEscapeDoublePress={true} focus={!isExporting} showCursor={!isExporting} columns={columns} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} />
          </Box>
        </Box>}
    </Dialog>;
}
