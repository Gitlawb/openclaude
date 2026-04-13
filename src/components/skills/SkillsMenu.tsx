import { c as _c } from "react-compiler-runtime";
import capitalize from 'lodash-es/capitalize.js';
import * as React from 'react';
import { useMemo } from 'react';
import { type Command, type CommandBase, type CommandResultDisplay, getCommandName, type PromptCommand } from '../../commands.js';
import { Box, Text } from '../../ink.js';
import { estimateSkillFrontmatterTokens, getSkillsPath } from '../../skills/loadSkillsDir.js';
import { getDisplayPath } from '../../utils/file.js';
import { formatTokens } from '../../utils/format.js';
import { getSettingSourceName, type SettingSource } from '../../utils/settings/constants.js';
import { plural } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Dialog } from '../design-system/Dialog.js';
import FullWidthRow from '../design-system/FullWidthRow.js';

// Skills are always PromptCommands with CommandBase properties
type SkillCommand = CommandBase & PromptCommand;
type SkillSource = SettingSource | 'plugin' | 'mcp';
type Props = {
  onExit: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  commands: Command[];
};
function getSourceTitle(source: SkillSource): string {
  if (source === 'plugin') {
    return 'Plugin skills';
  }
  if (source === 'mcp') {
    return 'MCP skills';
  }
  return `${capitalize(getSettingSourceName(source))} skills`;
}
function getSourceSubtitle(source: SkillSource, skills: SkillCommand[]): string | undefined {
  // MCP skills show server names; file-based skills show filesystem paths.
  // Skill names are `<server>:<skill>`, not `mcp__<server>__…`.
  if (source === 'mcp') {
    const servers = [...new Set(skills.map(s => {
      const idx = s.name.indexOf(':');
      return idx > 0 ? s.name.slice(0, idx) : null;
    }).filter((n): n is string => n != null))];
    return servers.length > 0 ? servers.join(', ') : undefined;
  }
  const skillsPath = getDisplayPath(getSkillsPath(source, 'skills'));
  const hasCommandsSkills = skills.some(s => s.loadedFrom === 'commands_DEPRECATED');
  return hasCommandsSkills ? `${skillsPath}, ${getDisplayPath(getSkillsPath(source, 'commands'))}` : skillsPath;
}
function getSkillListLabel(skill: SkillCommand): string {
  const leafName = skill.name.split(':').pop() ?? skill.name;
  return leafName === skill.name ? skill.name : `${skill.name} - ${leafName}`;
}
export function SkillsMenu(t0) {
  const $ = _c(35);
  const {
    onExit,
    commands
  } = t0;
  let t1;
  if ($[0] !== commands) {
    t1 = commands.filter(_temp);
    $[0] = commands;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const skills = t1;
  let groups;
  if ($[2] !== skills) {
    groups = {
      policySettings: [],
      userSettings: [],
      projectSettings: [],
      localSettings: [],
      flagSettings: [],
      plugin: [],
      mcp: []
    };
    for (const skill of skills) {
      const source = skill.source as SkillSource;
      if (source in groups) {
        groups[source].push(skill);
      }
    }
    for (const group of Object.values(groups)) {
      group.sort(_temp2);
    }
    $[2] = skills;
    $[3] = groups;
  } else {
    groups = $[3];
  }
  const skillsBySource = groups;
  let t2;
  if ($[4] !== onExit) {
    t2 = () => {
      onExit("Skills dialog dismissed", {
        display: "system"
      });
    };
    $[4] = onExit;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  const handleCancel = t2;
  if (skills.length === 0) {
    let t3;
    if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
      t3 = <FullWidthRow><Text dimColor={true}>Create skills in .claude/skills/ or ~/.claude/skills/</Text></FullWidthRow>;
      $[6] = t3;
    } else {
      t3 = $[6];
    }
    let t4;
    if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <FullWidthRow><Text dimColor={true} italic={true}><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="close" /></Text></FullWidthRow>;
      $[7] = t4;
    } else {
      t4 = $[7];
    }
    let t5;
    if ($[8] !== handleCancel) {
      t5 = <Dialog title="Skills" subtitle="No skills found" onCancel={handleCancel} hideInputGuide={true}>{t3}{t4}</Dialog>;
      $[8] = handleCancel;
      $[9] = t5;
    } else {
      t5 = $[9];
    }
    return t5;
  }
  const renderSkill = _temp3;
  let t3;
  if ($[10] !== skillsBySource) {
    t3 = source_0 => {
      const groupSkills = skillsBySource[source_0];
      if (groupSkills.length === 0) {
        return null;
      }
      const title = getSourceTitle(source_0);
      const subtitle = getSourceSubtitle(source_0, groupSkills);
      return <Box flexDirection="column" key={source_0}><FullWidthRow><Text bold={true} dimColor={true}>{title}</Text>{subtitle && <Text dimColor={true}> ({subtitle})</Text>}</FullWidthRow>{groupSkills.map(skill_1 => renderSkill(skill_1))}</Box>;
    };
    $[10] = skillsBySource;
    $[11] = t3;
  } else {
    t3 = $[11];
  }
  const renderSkillGroup = t3;
  const t4 = skills.length;
  let t5;
  if ($[12] !== skills.length) {
    t5 = plural(skills.length, "skill");
    $[12] = skills.length;
    $[13] = t5;
  } else {
    t5 = $[13];
  }
  const t6 = `${t4} ${t5}`;
  let t7;
  if ($[14] !== renderSkillGroup) {
    t7 = renderSkillGroup("projectSettings");
    $[14] = renderSkillGroup;
    $[15] = t7;
  } else {
    t7 = $[15];
  }
  let t8;
  if ($[16] !== renderSkillGroup) {
    t8 = renderSkillGroup("userSettings");
    $[16] = renderSkillGroup;
    $[17] = t8;
  } else {
    t8 = $[17];
  }
  let t9;
  if ($[18] !== renderSkillGroup) {
    t9 = renderSkillGroup("policySettings");
    $[18] = renderSkillGroup;
    $[19] = t9;
  } else {
    t9 = $[19];
  }
  let t10;
  if ($[20] !== renderSkillGroup) {
    t10 = renderSkillGroup("plugin");
    $[20] = renderSkillGroup;
    $[21] = t10;
  } else {
    t10 = $[21];
  }
  let t11;
  if ($[22] !== renderSkillGroup) {
    t11 = renderSkillGroup("mcp");
    $[22] = renderSkillGroup;
    $[23] = t11;
  } else {
    t11 = $[23];
  }
  let t12;
  if ($[24] !== t10 || $[25] !== t11 || $[26] !== t7 || $[27] !== t8 || $[28] !== t9) {
    t12 = <Box flexDirection="column" gap={1}>{t7}{t8}{t9}{t10}{t11}</Box>;
    $[24] = t10;
    $[25] = t11;
    $[26] = t7;
    $[27] = t8;
    $[28] = t9;
    $[29] = t12;
  } else {
    t12 = $[29];
  }
  let t13;
  if ($[30] === Symbol.for("react.memo_cache_sentinel")) {
    t13 = <FullWidthRow><Text dimColor={true} italic={true}><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="close" /></Text></FullWidthRow>;
    $[30] = t13;
  } else {
    t13 = $[30];
  }
  let t14;
  if ($[31] !== handleCancel || $[32] !== t12 || $[33] !== t6) {
    t14 = <Dialog title="Skills" subtitle={t6} onCancel={handleCancel} hideInputGuide={true}>{t12}{t13}</Dialog>;
    $[31] = handleCancel;
    $[32] = t12;
    $[33] = t6;
    $[34] = t14;
  } else {
    t14 = $[34];
  }
  return t14;
}
function _temp3(skill_0) {
  const estimatedTokens = estimateSkillFrontmatterTokens(skill_0);
  const tokenDisplay = `~${formatTokens(estimatedTokens)}`;
  const pluginName = skill_0.source === "plugin" ? skill_0.pluginInfo?.pluginManifest.name : undefined;
  return <FullWidthRow key={`${skill_0.name}-${skill_0.source}`}><Text>{getSkillListLabel(skill_0)}</Text><Text dimColor={true}>{pluginName ? ` · ${pluginName}` : ""} · {tokenDisplay} description tokens</Text></FullWidthRow>;
}
function _temp2(a, b) {
  return a.name.localeCompare(b.name);
}
function _temp(cmd) {
  return cmd.type === "prompt" && (cmd.loadedFrom === "skills" || cmd.loadedFrom === "commands_DEPRECATED" || cmd.loadedFrom === "plugin" || cmd.loadedFrom === "mcp");
}
