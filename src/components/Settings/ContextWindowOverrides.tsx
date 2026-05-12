import * as React from 'react';
import { useState, useCallback } from 'react';
import { Box, Text } from '../../ink.js';
import { Select } from '../CustomSelect/select.js';
import { Dialog } from '../design-system/Dialog.js';
import TextInput from '../TextInput.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';

type OverrideType = 'context' | 'maxTokens';

type Props = {
  initialContextOverrides?: Record<string, number>;
  initialMaxTokenOverrides?: Record<string, number>;
  onComplete: () => void;
  onCancel: () => void;
};

export function ContextWindowOverrides({
  initialContextOverrides = {},
  initialMaxTokenOverrides = {},
  onComplete,
  onCancel
}: Props) {
  const [contextOverrides, setContextOverrides] = useState(initialContextOverrides);
  const [maxTokenOverrides, setMaxTokenOverrides] = useState(initialMaxTokenOverrides);
  const [mode, setMode] = useState<'list' | 'addModel' | 'addValue'>('list');
  const [editingType, setEditingType] = useState<OverrideType>('context');
  const [newModelId, setNewModelId] = useState('');
  const [newValue, setNewValue] = useState('');

  const saveOverrides = useCallback((updatedContext: Record<string, number>, updatedMaxTokens: Record<string, number>) => {
    updateSettingsForSource('userSettings', {
      openaiContextWindows: updatedContext,
      openaiMaxOutputTokens: updatedMaxTokens
    });
    setContextOverrides(updatedContext);
    setMaxTokenOverrides(updatedMaxTokens);
  }, []);

  const handleSelect = (value: string) => {
    if (value === 'add-context') {
      setEditingType('context');
      setMode('addModel');
    } else if (value === 'add-max-tokens') {
      setEditingType('maxTokens');
      setMode('addModel');
    } else if (value.startsWith('delete-')) {
      const [,, type, modelId] = value.split('-');
      if (type === 'context') {
        const next = { ...contextOverrides };
        delete next[modelId!];
        saveOverrides(next, maxTokenOverrides);
      } else {
        const next = { ...maxTokenOverrides };
        delete next[modelId!];
        saveOverrides(contextOverrides, next);
      }
    }
  };

  const options = [
    { label: '[Add Context Window Override]', value: 'add-context' },
    { label: '[Add Max Output Tokens Override]', value: 'add-max-tokens' },
    ...Object.entries(contextOverrides).map(([model, val]) => ({
      label: `Context: ${model} (${val}) [Delete]`,
      value: `delete-context-context-${model}`
    })),
    ...Object.entries(maxTokenOverrides).map(([model, val]) => ({
      label: `Max Tokens: ${model} (${val}) [Delete]`,
      value: `delete-max-tokens-${model}`
    }))
  ];

  if (mode === 'addModel') {
    return (
      <Dialog title={`Add ${editingType === 'context' ? 'Context' : 'Max Tokens'} Override`} onCancel={() => setMode('list')}>
        <Box flexDirection="column" gap={1}>
          <Text>Enter Model ID (e.g. devstral-small-2):</Text>
          <TextInput
            value={newModelId}
            onChange={setNewModelId}
            onSubmit={() => setMode('addValue')}
            focus
          />
        </Box>
      </Dialog>
    );
  }

  if (mode === 'addValue') {
    return (
      <Dialog title={`Add ${editingType === 'context' ? 'Context' : 'Max Tokens'} Override`} onCancel={() => setMode('list')}>
        <Box flexDirection="column" gap={1}>
          <Text>Enter ${editingType === 'context' ? 'Context Window Size' : 'Max Output Tokens'} for {newModelId}:</Text>
          <TextInput
            value={newValue}
            onChange={setNewValue}
            onSubmit={() => {
              const numValue = parseInt(newValue, 10);
              if (!isNaN(numValue)) {
                if (editingType === 'context') {
                  saveOverrides({ ...contextOverrides, [newModelId]: numValue }, maxTokenOverrides);
                } else {
                  saveOverrides(contextOverrides, { ...maxTokenOverrides, [newModelId]: numValue });
                }
              }
              setNewModelId('');
              setNewValue('');
              setMode('list');
            }}
            focus
          />
        </Box>
      </Dialog>
    );
  }

  return (
    <Dialog title="Model Limit Overrides" onCancel={onCancel}>
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Manage custom limits for OpenAI-compatible models.</Text>
        <Select
          options={options}
          onChange={handleSelect}
          visibleOptionCount={10}
        />
        <Box marginTop={1}>
          <Text dimColor>Press Esc to go back</Text>
        </Box>
      </Box>
    </Dialog>
  );
}
