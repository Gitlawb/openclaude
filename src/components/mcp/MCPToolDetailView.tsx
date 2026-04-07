import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Box, Text } from '../../ink.js';
import { extractMcpToolDisplayName, getMcpDisplayName } from '../../services/mcp/mcpStringUtils.js';
import type { Tool } from '../../Tool.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Dialog } from '../design-system/Dialog.js';
import type { ServerInfo } from './types.js';
type Props = {
  tool: Tool;
  server: ServerInfo;
  onBack: () => void;
};
export function MCPToolDetailView(t0) {
  const $ = _c(44);
  const {
    tool,
    server,
    onBack
  } = t0;
  const [toolDescription, setToolDescription] = React.useState("");
  let t1;
  let toolName;
  if ($[0] !== server.name || $[1] !== tool) {
    toolName = getMcpDisplayName(tool.name, server.name);
    const fullDisplayName = tool.userFacingName ? tool.userFacingName({}) : toolName;
    t1 = extractMcpToolDisplayName(fullDisplayName);
    $[0] = server.name;
    $[1] = tool;
    $[2] = t1;
    $[3] = toolName;
  } else {
    t1 = $[2];
    toolName = $[3];
  }
  const displayName = t1;
  let t2;
  if ($[4] !== tool) {
    t2 = tool.isReadOnly?.({}) ?? false;
    $[4] = tool;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  const isReadOnly = t2;
  let t3;
  if ($[6] !== tool) {
    t3 = tool.isDestructive?.({}) ?? false;
    $[6] = tool;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  const isDestructive = t3;
  let t4;
  if ($[8] !== tool) {
    t4 = tool.isOpenWorld?.({}) ?? false;
    $[8] = tool;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  const isOpenWorld = t4;
  let t5;
  let t6;
  if ($[10] !== tool) {
    t5 = () => {
      const loadDescription = async function loadDescription() {
        try {
          const desc = await tool.description({}, {
            isNonInteractiveSession: false,
            toolPermissionContext: {
              mode: "default" as const,
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false
            },
            tools: []
          });
          setToolDescription(desc);
        } catch {
          setToolDescription("Failed to load description");
        }
      };
      loadDescription();
    };
    t6 = [tool];
    $[10] = tool;
    $[11] = t5;
    $[12] = t6;
  } else {
    t5 = $[11];
    t6 = $[12];
  }
  React.useEffect(t5, t6);
  let t7;
  if ($[13] !== isReadOnly) {
    t7 = isReadOnly && <Text color="success"> [read-only]</Text>;
    $[13] = isReadOnly;
    $[14] = t7;
  } else {
    t7 = $[14];
  }
  let t8;
  if ($[15] !== isDestructive) {
    t8 = isDestructive && <Text color="error"> [destructive]</Text>;
    $[15] = isDestructive;
    $[16] = t8;
  } else {
    t8 = $[16];
  }
  let t9;
  if ($[17] !== isOpenWorld) {
    t9 = isOpenWorld && <Text dimColor={true}> [open-world]</Text>;
    $[17] = isOpenWorld;
    $[18] = t9;
  } else {
    t9 = $[18];
  }
  let t10;
  if ($[19] !== displayName || $[20] !== t7 || $[21] !== t8 || $[22] !== t9) {
    t10 = <>{displayName}{t7}{t8}{t9}</>;
    $[19] = displayName;
    $[20] = t7;
    $[21] = t8;
    $[22] = t9;
    $[23] = t10;
  } else {
    t10 = $[23];
  }
  const titleContent = t10;
  let t11;
  if ($[24] === Symbol.for("react.memo_cache_sentinel")) {
    t11 = <Text bold={true}>Tool name: </Text>;
    $[24] = t11;
  } else {
    t11 = $[24];
  }
  let t12;
  if ($[25] !== toolName) {
    t12 = <Box>{t11}<Text dimColor={true}>{toolName}</Text></Box>;
    $[25] = toolName;
    $[26] = t12;
  } else {
    t12 = $[26];
  }
  let t13;
  if ($[27] === Symbol.for("react.memo_cache_sentinel")) {
    t13 = <Text bold={true}>Full name: </Text>;
    $[27] = t13;
  } else {
    t13 = $[27];
  }
  let t14;
  if ($[28] !== tool.name) {
    t14 = <Box>{t13}<Text dimColor={true}>{tool.name}</Text></Box>;
    $[28] = tool.name;
    $[29] = t14;
  } else {
    t14 = $[29];
  }
  let t15;
  if ($[30] !== toolDescription) {
    t15 = toolDescription && <Box flexDirection="column" marginTop={1}><Text bold={true}>Description:</Text><Text wrap="wrap">{toolDescription}</Text></Box>;
    $[30] = toolDescription;
    $[31] = t15;
  } else {
    t15 = $[31];
  }
  let t16;
  if ($[32] !== tool.inputJSONSchema) {
    t16 = tool.inputJSONSchema && tool.inputJSONSchema.properties && Object.keys(tool.inputJSONSchema.properties).length > 0 && <Box flexDirection="column" marginTop={1}><Text bold={true}>Parameters:</Text><Box marginLeft={2} flexDirection="column">{Object.entries(tool.inputJSONSchema.properties).map(t17 => {
          const [key, value] = t17;
          const required = tool.inputJSONSchema?.required as string[] | undefined;
          const isRequired = required?.includes(key);
          return <Text key={key}>• {key}{isRequired && <Text dimColor={true}> (required)</Text>}:{" "}<Text dimColor={true}>{typeof value === "object" && value && "type" in value ? String(value.type) : "unknown"}</Text>{typeof value === "object" && value && "description" in value && <Text dimColor={true}> - {String(value.description)}</Text>}</Text>;
        })}</Box></Box>;
    $[32] = tool.inputJSONSchema;
    $[33] = t16;
  } else {
    t16 = $[33];
  }
  let t17;
  if ($[34] !== t12 || $[35] !== t14 || $[36] !== t15 || $[37] !== t16) {
    t17 = <Box flexDirection="column">{t12}{t14}{t15}{t16}</Box>;
    $[34] = t12;
    $[35] = t14;
    $[36] = t15;
    $[37] = t16;
    $[38] = t17;
  } else {
    t17 = $[38];
  }
  let t18;
  if ($[39] !== onBack || $[40] !== server.name || $[41] !== t17 || $[42] !== titleContent) {
    t18 = <Dialog title={titleContent} subtitle={server.name} onCancel={onBack} inputGuide={_temp}>{t17}</Dialog>;
    $[39] = onBack;
    $[40] = server.name;
    $[41] = t17;
    $[42] = titleContent;
    $[43] = t18;
  } else {
    t18 = $[43];
  }
  return t18;
}
function _temp(exitState) {
  return exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="go back" />;
}
