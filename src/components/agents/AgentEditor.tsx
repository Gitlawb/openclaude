import chalk from 'chalk';
import figures from 'figures';
import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useSetAppState } from 'src/state/AppState.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import type { Tools } from '../../Tool.js';
import { type AgentColorName, setAgentColor } from '../../tools/AgentTool/agentColorManager.js';
import { type AgentDefinition, getActiveAgentsFromList, isCustomAgent, isPluginAgent } from '../../tools/AgentTool/loadAgentsDir.js';
import { editFileInEditor } from '../../utils/promptEditor.js';
import { getActualAgentFilePath, updateAgentFile } from './agentFileUtils.js';
import { ColorPicker } from './ColorPicker.js';
import { ModelSelector } from './ModelSelector.js';
import { ToolSelector } from './ToolSelector.js';
import { getAgentSourceDisplayName } from './utils.js';
type Props = {
  agent: AgentDefinition;
  tools: Tools;
  onSaved: (message: string) => void;
  onBack: () => void;
};
type EditMode = 'menu' | 'edit-tools' | 'edit-color' | 'edit-model';
type SaveChanges = {
  tools?: string[];
  color?: AgentColorName;
  model?: string;
};
export function AgentEditor({
  agent,
  tools,
  onSaved,
  onBack
}: Props): React.ReactNode {
  const setAppState = useSetAppState();
  const [editMode, setEditMode] = useState<EditMode>('menu');
  const [selectedMenuIndex, setSelectedMenuIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<AgentColorName | undefined>(agent.color as AgentColorName | undefined);
  const handleOpenInEditor = useCallback(async () => {
    const filePath = getActualAgentFilePath(agent);
    const result = await editFileInEditor(filePath);
    if (result.error) {
      setError(result.error);
    } else {
      onSaved(`Opened ${agent.agentType} in editor. If you made edits, restart to load the latest version.`);
    }
  }, [agent, onSaved]);
  const handleSave = useCallback(async (changes: SaveChanges = {}) => {
    const {
      tools: newTools,
      color: newColor,
      model: newModel
    } = changes;
    const finalColor = newColor ?? selectedColor;
    const hasToolsChanged = newTools !== undefined;
    const hasModelChanged = newModel !== undefined;
    const hasColorChanged = finalColor !== agent.color;
    if (!hasToolsChanged && !hasModelChanged && !hasColorChanged) {
      return false;
    }
    try {
      // Only custom/plugin agents can be edited
      // this is for type safety; the UI shouldn't allow editing otherwise
      if (!isCustomAgent(agent) && !isPluginAgent(agent)) {
        return false;
      }
      await updateAgentFile(agent, agent.whenToUse, newTools ?? agent.tools, agent.getSystemPrompt(), finalColor, newModel ?? agent.model);
      if (hasColorChanged && finalColor) {
        setAgentColor(agent.agentType, finalColor);
      }
      setAppState(state => {
        const allAgents = state.agentDefinitions.allAgents.map(a => a.agentType === agent.agentType ? {
          ...a,
          tools: newTools ?? a.tools,
          color: finalColor,
          model: newModel ?? a.model
        } : a);
        return {
          ...state,
          agentDefinitions: {
            ...state.agentDefinitions,
            activeAgents: getActiveAgentsFromList(allAgents),
            allAgents
          }
        };
      });
      onSaved(`Updated agent: ${chalk.bold(agent.agentType)}`);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent');
      return false;
    }
  }, [agent, selectedColor, onSaved, setAppState]);
  const menuItems = useMemo(() => [{
    label: 'Open in editor',
    action: handleOpenInEditor
  }, {
    label: 'Edit tools',
    action: () => setEditMode('edit-tools')
  }, {
    label: 'Edit model',
    action: () => setEditMode('edit-model')
  }, {
    label: 'Edit color',
    action: () => setEditMode('edit-color')
  }], [handleOpenInEditor]);
  const handleEscape = useCallback(() => {
    setError(null);
    if (editMode === 'menu') {
      onBack();
    } else {
      setEditMode('menu');
    }
  }, [editMode, onBack]);
  const handleMenuKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'up') {
      e.preventDefault();
      setSelectedMenuIndex(index => Math.max(0, index - 1));
    } else if (e.key === 'down') {
      e.preventDefault();
      setSelectedMenuIndex(index_0 => Math.min(menuItems.length - 1, index_0 + 1));
    } else if (e.key === 'return') {
      e.preventDefault();
      const selectedItem = menuItems[selectedMenuIndex];
      if (selectedItem) {
        void selectedItem.action();
      }
    }
  }, [menuItems, selectedMenuIndex]);
  useKeybinding('confirm:no', handleEscape, {
    context: 'Confirmation'
  });
  const renderMenu = (): React.ReactNode => <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleMenuKeyDown}>
      <Text dimColor>Source: {getAgentSourceDisplayName(agent.source)}</Text>

      <Box marginTop={1} flexDirection="column">
        {menuItems.map((item, index_1) => <Text key={item.label} color={index_1 === selectedMenuIndex ? 'suggestion' : undefined}>
            {index_1 === selectedMenuIndex ? `${figures.pointer} ` : '  '}
            {item.label}
          </Text>)}
      </Box>

      {error && <Box marginTop={1}>
          <Text color="error">{error}</Text>
        </Box>}
    </Box>;
  switch (editMode) {
    case 'menu':
      return renderMenu();
    case 'edit-tools':
      return <ToolSelector tools={tools} initialTools={agent.tools} onComplete={async finalTools => {
        setEditMode('menu');
        await handleSave({
          tools: finalTools
        });
      }} />;
    case 'edit-color':
      return <ColorPicker agentName={agent.agentType} currentColor={selectedColor || agent.color as AgentColorName || 'automatic'} onConfirm={async color => {
        setSelectedColor(color);
        setEditMode('menu');
        await handleSave({
          color
        });
      }} />;
    case 'edit-model':
      return <ModelSelector initialModel={agent.model} onComplete={async model => {
        setEditMode('menu');
        await handleSave({
          model
        });
      }} />;
    default:
      return null;
  }
}
