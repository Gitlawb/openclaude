import type { LocalCommandCall } from '../../types/command.js';
import { getArcSummary, resetArc, getArcStats } from '../../utils/conversationArc.js';
import { getGlobalGraph, resetGlobalGraph } from '../../utils/knowledgeGraph.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import chalk from 'chalk';

export const call: LocalCommandCall = async (args, _context) => {
  const arg = (args ? String(args) : '').trim().toLowerCase();
  const splitArgs = arg.split(/\s+/).filter(Boolean);
  const subCommand = splitArgs[0];

  if (!subCommand || subCommand === 'status') {
    const config = getGlobalConfig();
    const stats = getArcStats();
    const graph = getGlobalGraph();
    const entityCount = Object.keys(graph.entities).length;
    
    const statusText = (config.knowledgeGraphEnabled !== false)
      ? chalk.green('ENABLED') 
      : chalk.red('DISABLED');
      
    let output = `${chalk.bold('Knowledge Graph Engine')}: ${statusText}\n`;
    if (stats) {
      output += `• Stats: ${stats.goalCount} goals, ${stats.milestoneCount} milestones, ${entityCount} technical facts learned`;
    }
    
    return { type: 'text', value: output };
  }

  if (subCommand === 'enable') {
    const val = splitArgs[1];
    const isEnabled = val === 'yes' || val === 'true';
    const isDisabled = val === 'no' || val === 'false';

    if (!isEnabled && !isDisabled) {
      return { type: 'text', value: 'Usage: /knowledge enable <yes|no>' };
    }

    saveGlobalConfig(current => ({ ...current, knowledgeGraphEnabled: isEnabled }));
    return { 
      type: 'text', 
      value: `✨ Knowledge Graph engine ${isEnabled ? chalk.green('enabled') : chalk.red('disabled')}.` 
    };
  }

  if (subCommand === 'clear') {
    resetArc();
    resetGlobalGraph();
    return { 
      type: 'text', 
      value: '🗑️ Knowledge graph memory has been cleared for this session.' 
    };
  }

  if (subCommand === 'list') {
    return { type: 'text', value: getArcSummary() };
  }

  return { 
    type: 'text', 
    value: `Unknown subcommand: ${subCommand}. Available: enable, clear, status, list` 
  };
};
