import { c as _c } from "react-compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import type { SettingSource } from 'src/utils/settings/constants.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text } from '../../ink.js';
import type { ResolvedAgent } from '../../tools/AgentTool/agentDisplay.js';
import { AGENT_SOURCE_GROUPS, compareAgentsByName, getOverrideSourceLabel, resolveAgentModelDisplay } from '../../tools/AgentTool/agentDisplay.js';
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js';
import { count } from '../../utils/array.js';
import { Dialog } from '../design-system/Dialog.js';
import { Divider } from '../design-system/Divider.js';
import { getAgentSourceDisplayName } from './utils.js';
type Props = {
  source: SettingSource | 'all' | 'built-in' | 'plugin';
  agents: ResolvedAgent[];
  onBack: () => void;
  onSelect: (agent: AgentDefinition) => void;
  onCreateNew?: () => void;
  changes?: string[];
};
export function AgentsList(t0) {
  const $ = _c(96);
  const {
    source,
    agents,
    onBack,
    onSelect,
    onCreateNew,
    changes
  } = t0;
  const [selectedAgent, setSelectedAgent] = React.useState(null);
  const [isCreateNewSelected, setIsCreateNewSelected] = React.useState(true);
  let t1;
  if ($[0] !== agents) {
    t1 = [...agents].sort(compareAgentsByName);
    $[0] = agents;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const sortedAgents = t1;
  const getOverrideInfo = _temp;
  let t2;
  if ($[2] !== isCreateNewSelected) {
    t2 = () => <Box><Text color={isCreateNewSelected ? "suggestion" : undefined}>{isCreateNewSelected ? `${figures.pointer} ` : "  "}</Text><Text color={isCreateNewSelected ? "suggestion" : undefined}>Create new agent</Text></Box>;
    $[2] = isCreateNewSelected;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const renderCreateNewOption = t2;
  let t3;
  // @ts-expect-error React Compiler output loses type context
  if ($[4] !== isCreateNewSelected || $[5] !== selectedAgent?.agentType || $[6] !== selectedAgent?.source) {
    t3 = agent_0 => {
      const isBuiltIn = agent_0.source === "built-in";
      // @ts-expect-error React Compiler output loses type context
      const isSelected = !isBuiltIn && !isCreateNewSelected && selectedAgent?.agentType === agent_0.agentType && selectedAgent?.source === agent_0.source;
      const {
        isOverridden,
        overriddenBy
      } = getOverrideInfo(agent_0);
      const dimmed = isBuiltIn || isOverridden;
      const textColor = !isBuiltIn && isSelected ? "suggestion" : undefined;
      const resolvedModel = resolveAgentModelDisplay(agent_0);
      return <Box key={`${agent_0.agentType}-${agent_0.source}`}><Text dimColor={dimmed && !isSelected} color={textColor}>{isBuiltIn ? "" : isSelected ? `${figures.pointer} ` : "  "}</Text><Text dimColor={dimmed && !isSelected} color={textColor}>{agent_0.agentType}</Text>{resolvedModel && <Text dimColor={true} color={textColor}>{" \xB7 "}{resolvedModel}</Text>}{agent_0.memory && <Text dimColor={true} color={textColor}>{" \xB7 "}{agent_0.memory} memory</Text>}{overriddenBy && <Text dimColor={!isSelected} color={isSelected ? "warning" : undefined}>{" "}{figures.warning} shadowed by {getOverrideSourceLabel(overriddenBy)}</Text>}</Box>;
    };
    $[4] = isCreateNewSelected;
    // @ts-expect-error React Compiler output loses type context
    $[5] = selectedAgent?.agentType;
    // @ts-expect-error React Compiler output loses type context
    $[6] = selectedAgent?.source;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  const renderAgent = t3;
  let t4;
  if ($[8] !== sortedAgents || $[9] !== source) {
    bb0: {
      const nonBuiltIn = sortedAgents.filter(_temp2);
      if (source === "all") {
        t4 = AGENT_SOURCE_GROUPS.filter(_temp3).flatMap(t5 => {
          const {
            source: groupSource
          } = t5;
          return nonBuiltIn.filter(a_0 => a_0.source === groupSource);
        });
        break bb0;
      }
      t4 = nonBuiltIn;
    }
    $[8] = sortedAgents;
    $[9] = source;
    $[10] = t4;
  } else {
    t4 = $[10];
  }
  const selectableAgentsInOrder = t4;
  let t5;
  let t6;
  if ($[11] !== isCreateNewSelected || $[12] !== onCreateNew || $[13] !== selectableAgentsInOrder || $[14] !== selectedAgent) {
    t5 = () => {
      if (!selectedAgent && !isCreateNewSelected && selectableAgentsInOrder.length > 0) {
        if (onCreateNew) {
          setIsCreateNewSelected(true);
        } else {
          setSelectedAgent(selectableAgentsInOrder[0] || null);
        }
      }
    };
    t6 = [selectableAgentsInOrder, selectedAgent, isCreateNewSelected, onCreateNew];
    $[11] = isCreateNewSelected;
    $[12] = onCreateNew;
    $[13] = selectableAgentsInOrder;
    $[14] = selectedAgent;
    $[15] = t5;
    $[16] = t6;
  } else {
    t5 = $[15];
    t6 = $[16];
  }
  React.useEffect(t5, t6);
  let t7;
  if ($[17] !== isCreateNewSelected || $[18] !== onCreateNew || $[19] !== onSelect || $[20] !== selectableAgentsInOrder || $[21] !== selectedAgent) {
    t7 = e => {
      if (e.key === "return") {
        e.preventDefault();
        if (isCreateNewSelected && onCreateNew) {
          onCreateNew();
        } else {
          if (selectedAgent) {
            onSelect(selectedAgent);
          }
        }
        return;
      }
      if (e.key !== "up" && e.key !== "down") {
        return;
      }
      e.preventDefault();
      const hasCreateOption = !!onCreateNew;
      const totalItems = selectableAgentsInOrder.length + (hasCreateOption ? 1 : 0);
      if (totalItems === 0) {
        return;
      }
      let currentPosition = 0;
      if (!isCreateNewSelected && selectedAgent) {
        const agentIndex = selectableAgentsInOrder.findIndex(a_1 => a_1.agentType === (selectedAgent as any).agentType && a_1.source === (selectedAgent as any).source);
        if (agentIndex >= 0) {
          currentPosition = hasCreateOption ? agentIndex + 1 : agentIndex;
        }
      }
      const newPosition = e.key === "up" ? currentPosition === 0 ? totalItems - 1 : currentPosition - 1 : currentPosition === totalItems - 1 ? 0 : currentPosition + 1;
      if (hasCreateOption && newPosition === 0) {
        setIsCreateNewSelected(true);
        setSelectedAgent(null);
      } else {
        const agentIndex_0 = hasCreateOption ? newPosition - 1 : newPosition;
        const newAgent = selectableAgentsInOrder[agentIndex_0];
        if (newAgent) {
          setIsCreateNewSelected(false);
          setSelectedAgent(newAgent);
        }
      }
    };
    $[17] = isCreateNewSelected;
    $[18] = onCreateNew;
    $[19] = onSelect;
    $[20] = selectableAgentsInOrder;
    $[21] = selectedAgent;
    $[22] = t7;
  } else {
    t7 = $[22];
  }
  const handleKeyDown = t7;
  let t8;
  if ($[23] !== renderAgent || $[24] !== sortedAgents) {
    t8 = t9 => {
      const title = t9 === undefined ? "Built-in (always available):" : t9;
      const builtInAgents = sortedAgents.filter(_temp4);
      return <Box flexDirection="column" marginBottom={1} paddingLeft={2}><Text bold={true} dimColor={true}>{title}</Text>{builtInAgents.map(renderAgent)}</Box>;
    };
    $[23] = renderAgent;
    $[24] = sortedAgents;
    $[25] = t8;
  } else {
    t8 = $[25];
  }
  const renderBuiltInAgentsSection = t8;
  let t9;
  if ($[26] !== renderAgent) {
    t9 = (title_0, groupAgents) => {
      if (!groupAgents.length) {
        return null;
      }
      const folderPath = groupAgents[0]?.baseDir;
      return <Box flexDirection="column" marginBottom={1}><Box paddingLeft={2}><Text bold={true} dimColor={true}>{title_0}</Text>{folderPath && <Text dimColor={true}> ({folderPath})</Text>}</Box>{groupAgents.map(agent_1 => renderAgent(agent_1))}</Box>;
    };
    $[26] = renderAgent;
    $[27] = t9;
  } else {
    t9 = $[27];
  }
  const renderAgentGroup = t9;
  let t10;
  if ($[28] !== source) {
    t10 = getAgentSourceDisplayName(source);
    $[28] = source;
    $[29] = t10;
  } else {
    t10 = $[29];
  }
  const sourceTitle = t10;
  let T0;
  let T1;
  let t11;
  let t12;
  let t13;
  let t14;
  let t15;
  let t16;
  let t17;
  let t18;
  let t19;
  let t20;
  let t21;
  let t22;
  if ($[30] !== changes || $[31] !== handleKeyDown || $[32] !== onBack || $[33] !== onCreateNew || $[34] !== renderAgent || $[35] !== renderAgentGroup || $[36] !== renderBuiltInAgentsSection || $[37] !== renderCreateNewOption || $[38] !== sortedAgents || $[39] !== source || $[40] !== sourceTitle) {
    t22 = Symbol.for("react.early_return_sentinel");
    bb1: {
      const builtInAgents_0 = sortedAgents.filter(_temp5);
      const hasNoAgents = !sortedAgents.length || source !== "built-in" && !sortedAgents.some(_temp6);
      if (hasNoAgents) {
        let t23;
        if ($[55] !== onCreateNew || $[56] !== renderCreateNewOption) {
          t23 = onCreateNew && <Box>{renderCreateNewOption()}</Box>;
          $[55] = onCreateNew;
          $[56] = renderCreateNewOption;
          $[57] = t23;
        } else {
          t23 = $[57];
        }
        let t24;
        let t25;
        let t26;
        if ($[58] === Symbol.for("react.memo_cache_sentinel")) {
          t24 = <Text dimColor={true}>No agents found. Create specialized subagents that Claude can delegate to.</Text>;
          t25 = <Text dimColor={true}>Each subagent has its own context window, custom system prompt, and specific tools.</Text>;
          t26 = <Text dimColor={true}>Try creating: Code Reviewer, Code Simplifier, Security Reviewer, Tech Lead, or UX Reviewer.</Text>;
          $[58] = t24;
          $[59] = t25;
          $[60] = t26;
        } else {
          t24 = $[58];
          t25 = $[59];
          t26 = $[60];
        }
        let t27;
        if ($[61] !== renderBuiltInAgentsSection || $[62] !== sortedAgents || $[63] !== source) {
          t27 = source !== "built-in" && sortedAgents.some(_temp7) && <><Divider />{renderBuiltInAgentsSection()}</>;
          $[61] = renderBuiltInAgentsSection;
          $[62] = sortedAgents;
          $[63] = source;
          $[64] = t27;
        } else {
          t27 = $[64];
        }
        let t28;
        if ($[65] !== handleKeyDown || $[66] !== t23 || $[67] !== t27) {
          t28 = <Box flexDirection="column" gap={1} tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}>{t23}{t24}{t25}{t26}{t27}</Box>;
          $[65] = handleKeyDown;
          $[66] = t23;
          $[67] = t27;
          $[68] = t28;
        } else {
          t28 = $[68];
        }
        let t29;
        if ($[69] !== onBack || $[70] !== sourceTitle || $[71] !== t28) {
          t29 = <Dialog title={sourceTitle} subtitle="No agents found" onCancel={onBack} hideInputGuide={true}>{t28}</Dialog>;
          $[69] = onBack;
          $[70] = sourceTitle;
          $[71] = t28;
          $[72] = t29;
        } else {
          t29 = $[72];
        }
        t22 = t29;
        break bb1;
      }
      T1 = Dialog;
      t17 = sourceTitle;
      let t23;
      if ($[73] !== sortedAgents) {
        t23 = count(sortedAgents, _temp8);
        $[73] = sortedAgents;
        $[74] = t23;
      } else {
        t23 = $[74];
      }
      t18 = `${t23} agents`;
      t19 = onBack;
      t20 = true;
      if ($[75] !== changes) {
        t21 = changes && changes.length > 0 && <Box marginTop={1}><Text dimColor={true}>{changes[changes.length - 1]}</Text></Box>;
        $[75] = changes;
        $[76] = t21;
      } else {
        t21 = $[76];
      }
      T0 = Box;
      t11 = "column";
      t12 = 0;
      t13 = true;
      t14 = handleKeyDown;
      if ($[77] !== onCreateNew || $[78] !== renderCreateNewOption) {
        t15 = onCreateNew && <Box marginBottom={1}>{renderCreateNewOption()}</Box>;
        $[77] = onCreateNew;
        $[78] = renderCreateNewOption;
        $[79] = t15;
      } else {
        t15 = $[79];
      }
      t16 = source === "all" ? <>{AGENT_SOURCE_GROUPS.filter(_temp9).map(t24 => {
          const {
            label,
            source: groupSource_0
          } = t24;
          return <React.Fragment key={groupSource_0}>{renderAgentGroup(label, sortedAgents.filter(a_7 => a_7.source === groupSource_0))}</React.Fragment>;
        })}{builtInAgents_0.length > 0 && <Box flexDirection="column" marginBottom={1} paddingLeft={2}><Text dimColor={true}><Text bold={true}>Built-in agents</Text> (always available)</Text>{builtInAgents_0.map(renderAgent)}</Box>}</> : source === "built-in" ? <><Text dimColor={true} italic={true}>Built-in agents are provided by default and cannot be modified.</Text><Box marginTop={1} flexDirection="column">{sortedAgents.map(agent_2 => renderAgent(agent_2))}</Box></> : <>{sortedAgents.filter(_temp0).map(agent_3 => renderAgent(agent_3))}{sortedAgents.some(_temp1) && <><Divider />{renderBuiltInAgentsSection()}</>}</>;
    }
    $[30] = changes;
    $[31] = handleKeyDown;
    $[32] = onBack;
    $[33] = onCreateNew;
    $[34] = renderAgent;
    $[35] = renderAgentGroup;
    $[36] = renderBuiltInAgentsSection;
    $[37] = renderCreateNewOption;
    $[38] = sortedAgents;
    $[39] = source;
    $[40] = sourceTitle;
    $[41] = T0;
    $[42] = T1;
    $[43] = t11;
    $[44] = t12;
    $[45] = t13;
    $[46] = t14;
    $[47] = t15;
    $[48] = t16;
    $[49] = t17;
    $[50] = t18;
    $[51] = t19;
    $[52] = t20;
    $[53] = t21;
    $[54] = t22;
  } else {
    T0 = $[41];
    T1 = $[42];
    t11 = $[43];
    t12 = $[44];
    t13 = $[45];
    t14 = $[46];
    t15 = $[47];
    t16 = $[48];
    t17 = $[49];
    t18 = $[50];
    t19 = $[51];
    t20 = $[52];
    t21 = $[53];
    t22 = $[54];
  }
  if (t22 !== Symbol.for("react.early_return_sentinel")) {
    return t22;
  }
  let t23;
  if ($[80] !== T0 || $[81] !== t11 || $[82] !== t12 || $[83] !== t13 || $[84] !== t14 || $[85] !== t15 || $[86] !== t16) {
    t23 = <T0 flexDirection={t11} tabIndex={t12} autoFocus={t13} onKeyDown={t14}>{t15}{t16}</T0>;
    $[80] = T0;
    $[81] = t11;
    $[82] = t12;
    $[83] = t13;
    $[84] = t14;
    $[85] = t15;
    $[86] = t16;
    $[87] = t23;
  } else {
    t23 = $[87];
  }
  let t24;
  if ($[88] !== T1 || $[89] !== t17 || $[90] !== t18 || $[91] !== t19 || $[92] !== t20 || $[93] !== t21 || $[94] !== t23) {
    t24 = <T1 title={t17} subtitle={t18} onCancel={t19} hideInputGuide={t20}>{t21}{t23}</T1>;
    $[88] = T1;
    $[89] = t17;
    $[90] = t18;
    $[91] = t19;
    $[92] = t20;
    $[93] = t21;
    $[94] = t23;
    $[95] = t24;
  } else {
    t24 = $[95];
  }
  return t24;
}
function _temp1(a_9) {
  return a_9.source === "built-in";
}
function _temp0(a_8) {
  return a_8.source !== "built-in";
}
function _temp9(g_0) {
  return g_0.source !== "built-in";
}
function _temp8(a_6) {
  return !a_6.overriddenBy;
}
function _temp7(a_5) {
  return a_5.source === "built-in";
}
function _temp6(a_4) {
  return a_4.source !== "built-in";
}
function _temp5(a_3) {
  return a_3.source === "built-in";
}
function _temp4(a_2) {
  return a_2.source === "built-in";
}
function _temp3(g) {
  return g.source !== "built-in";
}
function _temp2(a) {
  return a.source !== "built-in";
}
function _temp(agent) {
  return {
    isOverridden: !!agent.overriddenBy,
    overriddenBy: agent.overriddenBy || null
  };
}
