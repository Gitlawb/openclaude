import * as React from 'react';
import { useState, useCallback } from 'react';
import { Box, Text } from '../../ink.js';
import { Select } from '../CustomSelect/select.js';
import { Dialog } from '../design-system/Dialog.js';
import TextInput from '../TextInput.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';

type ModelConfig = {
  base_url?: string;
  api_key?: string;
  context_window?: number;
  max_tokens?: number;
};

type Props = {
  initialAgentModels?: Record<string, { base_url: string; api_key: string }>;
  initialContextWindows?: Record<string, number>;
  initialMaxTokens?: Record<string, number>;
  onComplete: () => void;
  onCancel: () => void;
};

export function ModelProviderSettings({
  initialAgentModels = {},
  initialContextWindows = {},
  initialMaxTokens = {},
  onComplete,
  onCancel
}: Props) {
  const [agentModels, setAgentModels] = useState(initialAgentModels);
  const [contextWindows, setContextWindows] = useState(initialContextWindows);
  const [maxTokens, setMaxTokens] = useState(initialMaxTokens);

  const [mode, setMode] = useState<'list' | 'editModel' | 'editField'>('list');
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'id' | 'base_url' | 'api_key' | 'context_window' | 'max_tokens' | null>(null);
  const [inputValue, setInputValue] = useState('');

  const allModelIds = Array.from(new Set([
    ...Object.keys(agentModels),
    ...Object.keys(contextWindows),
    ...Object.keys(maxTokens)
  ]));

  const saveAll = useCallback((
    updatedAgent: Record<string, { base_url: string; api_key: string }>,
    updatedContext: Record<string, number>,
    updatedMax: Record<string, number>
  ) => {
    updateSettingsForSource('userSettings', {
      agentModels: updatedAgent,
      openaiContextWindows: updatedContext,
      openaiMaxOutputTokens: updatedMax
    });
    setAgentModels(updatedAgent);
    setContextWindows(updatedContext);
    setMaxTokens(updatedMax);
  }, []);

  const handleListSelect = (value: string) => {
    if (value === 'add-new') {
      setSelectedModel(null);
      setEditingField('id');
      setInputValue('');
      setMode('editField');
    } else if (value.startsWith('edit-')) {
      setSelectedModel(value.replace('edit-', ''));
      setMode('editModel');
    } else if (value.startsWith('delete-')) {
      const id = value.replace('delete-', '');
      const nextAgent = { ...agentModels };
      const nextContext = { ...contextWindows };
      const nextMax = { ...maxTokens };
      delete nextAgent[id];
      delete nextContext[id];
      delete nextMax[id];
      
      updateSettingsForSource('userSettings', {
        agentModels: { [id]: undefined } as any,
        openaiContextWindows: { [id]: undefined } as any,
        openaiMaxOutputTokens: { [id]: undefined } as any
      });
      
      setAgentModels(nextAgent);
      setContextWindows(nextContext);
      setMaxTokens(nextMax);
    }
  };

  const handleEditModelSelect = (value: string) => {
    if (value === 'back') {
      setMode('list');
    } else if (value === 'delete') {
      if (selectedModel) {
        const nextAgent = { ...agentModels };
        const nextContext = { ...contextWindows };
        const nextMax = { ...maxTokens };
        delete nextAgent[selectedModel];
        delete nextContext[selectedModel];
        delete nextMax[selectedModel];
        
        updateSettingsForSource('userSettings', {
          agentModels: { [selectedModel]: undefined } as any,
          openaiContextWindows: { [selectedModel]: undefined } as any,
          openaiMaxOutputTokens: { [selectedModel]: undefined } as any
        });
        
        setAgentModels(nextAgent);
        setContextWindows(nextContext);
        setMaxTokens(nextMax);
        setMode('list');
      }
    } else if (value === 'set-default') {
      if (selectedModel) {
        updateSettingsForSource('userSettings', {
          model: selectedModel
        });
        setMode('list');
      }
    } else {
      setEditingField(value as any);
      let currentVal = '';
      if (selectedModel) {
        if (value === 'base_url') currentVal = agentModels[selectedModel]?.base_url || '';
        if (value === 'api_key') currentVal = agentModels[selectedModel]?.api_key || '';
        if (value === 'context_window') currentVal = String(contextWindows[selectedModel] || '');
        if (value === 'max_tokens') currentVal = String(maxTokens[selectedModel] || '');
      }
      setInputValue(currentVal);
      setMode('editField');
    }
  };

  const handleFieldSubmit = () => {
    if (editingField === 'id') {
      const id = inputValue.trim();
      if (id) {
        setSelectedModel(id);
        setMode('editModel');
      } else {
        setMode('list');
      }
      return;
    }

    if (!selectedModel) return;

    const nextAgent = { ...agentModels };
    const nextContext = { ...contextWindows };
    const nextMax = { ...maxTokens };

    if (editingField === 'base_url') {
      nextAgent[selectedModel] = { ...nextAgent[selectedModel], base_url: inputValue, api_key: nextAgent[selectedModel]?.api_key || '' };
    } else if (editingField === 'api_key') {
      nextAgent[selectedModel] = { ...nextAgent[selectedModel], api_key: inputValue, base_url: nextAgent[selectedModel]?.base_url || '' };
    } else if (editingField === 'context_window') {
      const val = parseInt(inputValue, 10);
      if (!isNaN(val) && val > 0) nextContext[selectedModel] = val;else delete nextContext[selectedModel];
    } else if (editingField === 'max_tokens') {
      const val = parseInt(inputValue, 10);
      if (!isNaN(val) && val > 0) nextMax[selectedModel] = val;else delete nextMax[selectedModel];
    }

    saveAll(nextAgent, nextContext, nextMax);
    setMode('editModel');
  };

  if (mode === 'editField') {
    return (
      <Dialog title={`Edit ${editingField}`} onCancel={() => setMode(selectedModel ? 'editModel' : 'list')} isCancelActive={false}>
        <Box flexDirection="column" gap={1}>
          <Text>Enter {editingField}:</Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleFieldSubmit}
            onExit={() => setMode(selectedModel ? 'editModel' : 'list')}
            mask={editingField === 'api_key' ? '*' : undefined}
            focus
          />
        </Box>
      </Dialog>
    );
  }

  if (mode === 'editModel') {
    return (
      <Dialog title={`Model: ${selectedModel}`} onCancel={() => setMode('list')}>
        <Box flexDirection="column" gap={1}>
          <Select
            options={[
              { label: `Base URL: ${agentModels[selectedModel!]?.base_url || 'Not set'}`, value: 'base_url' },
              { label: `API Key: ${agentModels[selectedModel!]?.api_key ? '********' : 'Not set'}`, value: 'api_key' },
              { label: `Context Window: ${contextWindows[selectedModel!] || 'Default (128k)'}`, value: 'context_window' },
              { label: `Max Tokens: ${maxTokens[selectedModel!] || 'Default'}`, value: 'max_tokens' },
              { label: '[Set as Default Model]', value: 'set-default' },
              { label: <Text color="error">[Delete This Provider]</Text>, value: 'delete' },
              { label: '<-- Back', value: 'back' }
            ]}
            onChange={handleEditModelSelect}
          />
        </Box>
      </Dialog>
    );
  }

  const listOptions = [
    { label: '[Add New Model Provider]', value: 'add-new' },
    ...allModelIds.map(id => ({
      label: `Edit: ${id}`,
      value: `edit-${id}`
    }))
  ];

  return (
    <Dialog title="Custom Model Providers" onCancel={onCancel}>
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Configure endpoints and limits for OpenAI-compatible models.</Text>
        <Select
          options={listOptions}
          onChange={handleListSelect}
          visibleOptionCount={10}
        />
        <Box marginTop={1}>
          <Text dimColor>Press Esc to go back, Space to select</Text>
        </Box>
      </Box>
    </Dialog>
  );
}
