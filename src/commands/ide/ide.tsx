import { c as _c } from "react-compiler-runtime";
import chalk from 'chalk';
import * as path from 'path';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { Select } from '../../components/CustomSelect/index.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { IdeAutoConnectDialog, IdeDisableAutoConnectDialog, shouldShowAutoConnectDialog, shouldShowDisableAutoConnectDialog } from '../../components/IdeAutoConnectDialog.js';
import { Box, Text } from '../../ink.js';
import { clearServerCache } from '../../services/mcp/client.js';
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import { getCwd } from '../../utils/cwd.js';
import { execFileNoThrow } from '../../utils/execFileNoThrow.js';
import { type DetectedIDEInfo, detectIDEs, detectRunningIDEs, type IdeType, isJetBrainsIde, isSupportedJetBrainsTerminal, isSupportedTerminal, toIDEDisplayName } from '../../utils/ide.js';
import { getCurrentWorktreeSession } from '../../utils/worktree.js';
type IDEScreenProps = {
  availableIDEs: DetectedIDEInfo[];
  unavailableIDEs: DetectedIDEInfo[];
  selectedIDE?: DetectedIDEInfo | null;
  onClose: () => void;
  onSelect: (ide?: DetectedIDEInfo) => void;
};
function IDEScreen(t0) {
  const $ = _c(39);
  const {
    availableIDEs,
    unavailableIDEs,
    selectedIDE,
    onClose,
    onSelect
  } = t0;
  let t1;
  if ($[0] !== selectedIDE?.port) {
    t1 = selectedIDE?.port?.toString() ?? "Жоден";
    $[0] = selectedIDE?.port;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const [selectedValue, setSelectedValue] = useState(t1);
  const [showAutoConnectDialog, setShowAutoConnectDialog] = useState(false);
  const [showDisableAutoConnectDialog, setShowDisableAutoConnectDialog] = useState(false);
  let t2;
  if ($[2] !== availableIDEs || $[3] !== onSelect) {
    t2 = value => {
      if (value !== "Жоден" && shouldShowAutoConnectDialog()) {
        setShowAutoConnectDialog(true);
      } else {
        if (value === "Жоден" && shouldShowDisableAutoConnectDialog()) {
          setShowDisableAutoConnectDialog(true);
        } else {
          onSelect(availableIDEs.find(ide => ide.port === parseInt(value)));
        }
      }
    };
    $[2] = availableIDEs;
    $[3] = onSelect;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const handleSelectIDE = t2;
  let t3;
  if ($[5] !== availableIDEs) {
    t3 = availableIDEs.reduce(_temp, {});
    $[5] = availableIDEs;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const ideCounts = t3;
  let t4;
  if ($[7] !== availableIDEs || $[8] !== ideCounts) {
    let t5;
    if ($[10] !== ideCounts) {
      t5 = ide_1 => {
        const hasMultipleInstances = (ideCounts[ide_1.name] || 0) > 1;
        const showWorkspace = hasMultipleInstances && ide_1.workspaceFolders.length > 0;
        return {
          label: ide_1.name,
          value: ide_1.port.toString(),
          description: showWorkspace ? formatWorkspaceFolders(ide_1.workspaceFolders) : undefined
        };
      };
      $[10] = ideCounts;
      $[11] = t5;
    } else {
      t5 = $[11];
    }
    t4 = availableIDEs.map(t5).concat([{
      label: "Жоден",
      value: "Жоден",
      description: undefined
    }]);
    $[7] = availableIDEs;
    $[8] = ideCounts;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  const options = t4;
  if (showAutoConnectDialog) {
    let t5;
    if ($[12] !== handleSelectIDE || $[13] !== selectedValue) {
      t5 = <IdeAutoConnectDialog onComplete={() => handleSelectIDE(selectedValue)} />;
      $[12] = handleSelectIDE;
      $[13] = selectedValue;
      $[14] = t5;
    } else {
      t5 = $[14];
    }
    return t5;
  }
  if (showDisableAutoConnectDialog) {
    let t5;
    if ($[15] !== onSelect) {
      t5 = <IdeDisableAutoConnectDialog onComplete={() => {
        onSelect(undefined);
      }} />;
      $[15] = onSelect;
      $[16] = t5;
    } else {
      t5 = $[16];
    }
    return t5;
  }
  let t5;
  if ($[17] !== availableIDEs.length) {
    t5 = availableIDEs.length === 0 && <Text dimColor={true}>{isSupportedJetBrainsTerminal() ? "Доступних IDE не виявлено. Встановіть плагін і перезапустіть ваш IDE:\nhttps://docs.claude.com/s/claude-code-jetbrains" : "Доступних IDE не виявлено. Переконайтеся, що у вашому IDE встановлено розширення/плагін Нейромережі і він запущений."}</Text>;
    $[17] = availableIDEs.length;
    $[18] = t5;
  } else {
    t5 = $[18];
  }
  let t6;
  if ($[19] !== availableIDEs.length || $[20] !== handleSelectIDE || $[21] !== options || $[22] !== selectedValue) {
    t6 = availableIDEs.length !== 0 && <Select defaultValue={selectedValue} defaultFocusValue={selectedValue} options={options} onChange={value_0 => {
      setSelectedValue(value_0);
      handleSelectIDE(value_0);
    }} />;
    $[19] = availableIDEs.length;
    $[20] = handleSelectIDE;
    $[21] = options;
    $[22] = selectedValue;
    $[23] = t6;
  } else {
    t6 = $[23];
  }
  let t7;
  if ($[24] !== availableIDEs) {
    t7 = availableIDEs.length !== 0 && availableIDEs.some(_temp2) && <Box marginTop={1}><Text color="warning">Примітка: Тільки один екземпляр Нейромережі може бути підключений до VS Code одночасно.</Text></Box>;
    $[24] = availableIDEs;
    $[25] = t7;
  } else {
    t7 = $[25];
  }
  let t8;
  if ($[26] !== availableIDEs.length) {
    t8 = availableIDEs.length !== 0 && !isSupportedTerminal() && <Box marginTop={1}><Text dimColor={true}>Порада: Ви можете увімкнути автопідключення до IDE в /config або через прапорець --ide</Text></Box>;
    $[26] = availableIDEs.length;
    $[27] = t8;
  } else {
    t8 = $[27];
  }
  let t9;
  if ($[28] !== unavailableIDEs) {
    t9 = unavailableIDEs.length > 0 && <Box marginTop={1} flexDirection="column"><Text dimColor={true}>Знайдено {unavailableIDEs.length} інших запущених IDE. Однак їхні робочі директорії/проєкти не збігаються з поточним cwd.</Text><Box marginTop={1} flexDirection="column">{unavailableIDEs.map(_temp3)}</Box></Box>;
    $[28] = unavailableIDEs;
    $[29] = t9;
  } else {
    t9 = $[29];
  }
  let t10;
  if ($[30] !== t5 || $[31] !== t6 || $[32] !== t7 || $[33] !== t8 || $[34] !== t9) {
    t10 = <Box flexDirection="column">{t5}{t6}{t7}{t8}{t9}</Box>;
    $[30] = t5;
    $[31] = t6;
    $[32] = t7;
    $[33] = t8;
    $[34] = t9;
    $[35] = t10;
  } else {
    t10 = $[35];
  }
  let t11;
  if ($[36] !== onClose || $[37] !== t10) {
    t11 = <Dialog title="Оберіть IDE" subtitle="Підключіться до IDE для інтегрованих функцій розробки." onCancel={onClose} color="ide">{t10}</Dialog>;
    $[36] = onClose;
    $[37] = t10;
    $[38] = t11;
  } else {
    t11 = $[38];
  }
  return t11;
}
function _temp3(ide_3, index) {
  return <Box key={index} paddingLeft={3}><Text dimColor={true}>• {ide_3.name}: {formatWorkspaceFolders(ide_3.workspaceFolders)}</Text></Box>;
}
function _temp2(ide_2) {
  return ide_2.name === "VS Code" || ide_2.name === "Visual Studio Code";
}
function _temp(acc, ide_0) {
  acc[ide_0.name] = (acc[ide_0.name] || 0) + 1;
  return acc;
}
async function findCurrentIDE(availableIDEs: DetectedIDEInfo[], dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>): Promise<DetectedIDEInfo | null> {
  const currentConfig = dynamicMcpConfig?.ide;
  if (!currentConfig || currentConfig.type !== 'sse-ide' && currentConfig.type !== 'ws-ide') {
    return null;
  }
  for (const ide of availableIDEs) {
    if (ide.url === currentConfig.url) {
      return ide;
    }
  }
  return null;
}
type IDEOpenSelectionProps = {
  availableIDEs: DetectedIDEInfo[];
  onSelectIDE: (ide?: DetectedIDEInfo) => void;
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
function IDEOpenSelection(t0) {
  const $ = _c(18);
  const {
    availableIDEs,
    onSelectIDE,
    onDone
  } = t0;
  let t1;
  if ($[0] !== availableIDEs[0]?.port) {
    t1 = availableIDEs[0]?.port?.toString() ?? "";
    $[0] = availableIDEs[0]?.port;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const [selectedValue, setSelectedValue] = useState(t1);
  let t2;
  if ($[2] !== availableIDEs || $[3] !== onSelectIDE) {
    t2 = value => {
      const selectedIDE = availableIDEs.find(ide => ide.port === parseInt(value));
      onSelectIDE(selectedIDE);
    };
    $[2] = availableIDEs;
    $[3] = onSelectIDE;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const handleSelectIDE = t2;
  let t3;
  if ($[5] !== availableIDEs) {
    t3 = availableIDEs.map(_temp4);
    $[5] = availableIDEs;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const options = t3;
  let t4;
  if ($[7] !== onDone) {
    t4 = function handleCancel() {
      onDone("Вибір IDE скасовано", {
        display: "system"
      });
    };
    $[7] = onDone;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  const handleCancel = t4;
  let t5;
  if ($[9] !== handleSelectIDE) {
    t5 = value_0 => {
      setSelectedValue(value_0);
      handleSelectIDE(value_0);
    };
    $[9] = handleSelectIDE;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] !== options || $[12] !== selectedValue || $[13] !== t5) {
    t6 = <Select defaultValue={selectedValue} defaultFocusValue={selectedValue} options={options} onChange={t5} />;
    $[11] = options;
    $[12] = selectedValue;
    $[13] = t5;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  let t7;
  if ($[15] !== handleCancel || $[16] !== t6) {
    t7 = <Dialog title="Оберіть IDE для відкриття проєкту" onCancel={handleCancel} color="ide">{t6}</Dialog>;
    $[15] = handleCancel;
    $[16] = t6;
    $[17] = t7;
  } else {
    t7 = $[17];
  }
  return t7;
}
function _temp4(ide_0) {
  return {
    label: ide_0.name,
    value: ide_0.port.toString()
  };
}
function RunningIDESelector(t0) {
  const $ = _c(15);
  const {
    runningIDEs,
    onSelectIDE,
    onDone
  } = t0;
  const [selectedValue, setSelectedValue] = useState(runningIDEs[0] ?? "");
  let t1;
  if ($[0] !== onSelectIDE) {
    t1 = value => {
      onSelectIDE(value as IdeType);
    };
    $[0] = onSelectIDE;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const handleSelectIDE = t1;
  let t2;
  if ($[2] !== runningIDEs) {
    t2 = runningIDEs.map(_temp5);
    $[2] = runningIDEs;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const options = t2;
  let t3;
  if ($[4] !== onDone) {
    t3 = function handleCancel() {
      onDone("Вибір IDE скасовано", {
        display: "system"
      });
    };
    $[4] = onDone;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const handleCancel = t3;
  let t4;
  if ($[6] !== handleSelectIDE) {
    t4 = value_0 => {
      setSelectedValue(value_0);
      handleSelectIDE(value_0);
    };
    $[6] = handleSelectIDE;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== options || $[9] !== selectedValue || $[10] !== t4) {
    t5 = <Select defaultFocusValue={selectedValue} options={options} onChange={t4} />;
    $[8] = options;
    $[9] = selectedValue;
    $[10] = t4;
    $[11] = t5;
  } else {
    t5 = $[11];
  }
  let t6;
  if ($[12] !== handleCancel || $[13] !== t5) {
    t6 = <Dialog title="Оберіть IDE для встановлення розширення" onCancel={handleCancel} color="ide">{t5}</Dialog>;
    $[12] = handleCancel;
    $[13] = t5;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  return t6;
}
function _temp5(ide) {
  return {
    label: toIDEDisplayName(ide),
    value: ide
  };
}
function InstallOnMount(t0) {
  const $ = _c(4);
  const {
    ide,
    onInstall
  } = t0;
  let t1;
  let t2;
  if ($[0] !== ide || $[1] !== onInstall) {
    t1 = () => {
      onInstall(ide);
    };
    t2 = [ide, onInstall];
    $[0] = ide;
    $[1] = onInstall;
    $[2] = t1;
    $[3] = t2;
  } else {
    t1 = $[2];
    t2 = $[3];
  }
  useEffect(t1, t2);
  return null;
}
export async function call(onDone: (result?: string, options?: {
  display?: CommandResultDisplay;
}) => void, context: LocalJSXCommandContext, args: string): Promise<React.ReactNode | null> {
  logEvent('tengu_ext_ide_command', {});
  const {
    options: {
      dynamicMcpConfig
    },
    onChangeDynamicMcpConfig
  } = context;

  // Handle 'open' argument
  if (args?.trim() === 'open') {
    const worktreeSession = getCurrentWorktreeSession();
    const targetPath = worktreeSession ? worktreeSession.worktreePath : getCwd();

    // Detect available IDEs
    const detectedIDEs = await detectIDEs(true);
    const availableIDEs = detectedIDEs.filter(ide => ide.isValid);
    if (availableIDEs.length === 0) {
      onDone('Не виявлено IDE з розширенням Нейромережі.');
      return null;
    }

    // Return IDE selection component
    return <IDEOpenSelection availableIDEs={availableIDEs} onSelectIDE={async (selectedIDE?: DetectedIDEInfo) => {
      if (!selectedIDE) {
        onDone('IDE не обрано.');
        return;
      }

      // Try to open the project in the selected IDE
      if (selectedIDE.name.toLowerCase().includes('vscode') || selectedIDE.name.toLowerCase().includes('cursor') || selectedIDE.name.toLowerCase().includes('windsurf')) {
        // VS Code-based IDEs
        const {
          code
        } = await execFileNoThrow('code', [targetPath]);
        if (code === 0) {
          onDone(`Відкрито ${worktreeSession ? 'worktree' : 'проєкт'} у ${chalk.bold(selectedIDE.name)}`);
        } else {
          onDone(`Не вдалося відкрити у ${selectedIDE.name}. Спробуйте відкрити вручну: ${targetPath}`);
        }
      } else if (isSupportedJetBrainsTerminal()) {
        // JetBrains IDEs - they usually open via their CLI tools
        onDone(`Будь ласка, відкрийте ${worktreeSession ? 'worktree' : 'проєкт'} вручну у ${chalk.bold(selectedIDE.name)}: ${targetPath}`);
      } else {
        onDone(`Будь ласка, відкрийте ${worktreeSession ? 'worktree' : 'проєкт'} вручну у ${chalk.bold(selectedIDE.name)}: ${targetPath}`);
      }
    }} onDone={() => {
      onDone('Вийшли без відкриття IDE', {
        display: 'system'
      });
    }} />;
  }
  const detectedIDEs = await detectIDEs(true);

  // If no IDEs with extensions detected, check for running IDEs and offer to install
  if (detectedIDEs.length === 0 && context.onInstallIDEExtension && !isSupportedTerminal()) {
    const runningIDEs = await detectRunningIDEs();
    const onInstall = (ide: IdeType) => {
      if (context.onInstallIDEExtension) {
        context.onInstallIDEExtension(ide);
        // The completion message will be shown after installation
        if (isJetBrainsIde(ide)) {
          onDone(`Плагін встановлено в ${chalk.bold(toIDEDisplayName(ide))}\n` + `Будь ласка, ${chalk.bold('повністю перезапустіть IDE')}, щоб зміни набули чинності`);
        } else {
          onDone(`Розширення встановлено в ${chalk.bold(toIDEDisplayName(ide))}`);
        }
      }
    };
    if (runningIDEs.length > 1) {
      // Show selector when multiple IDEs are running
      return <RunningIDESelector runningIDEs={runningIDEs} onSelectIDE={onInstall} onDone={() => {
        onDone('IDE не обрано.', {
          display: 'system'
        });
      }} />;
    } else if (runningIDEs.length === 1) {
      return <InstallOnMount ide={runningIDEs[0]!} onInstall={onInstall} />;
    }
  }
  const availableIDEs = detectedIDEs.filter(ide => ide.isValid);
  const unavailableIDEs = detectedIDEs.filter(ide => !ide.isValid);
  const currentIDE = await findCurrentIDE(availableIDEs, dynamicMcpConfig);
  return <IDECommandFlow availableIDEs={availableIDEs} unavailableIDEs={unavailableIDEs} currentIDE={currentIDE} dynamicMcpConfig={dynamicMcpConfig} onChangeDynamicMcpConfig={onChangeDynamicMcpConfig} onDone={onDone} />;
}

// Connection timeout slightly longer than the 30s MCP connection timeout
const IDE_CONNECTION_TIMEOUT_MS = 35000;
type IDECommandFlowProps = {
  availableIDEs: DetectedIDEInfo[];
  unavailableIDEs: DetectedIDEInfo[];
  currentIDE: DetectedIDEInfo | null;
  dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>;
  onChangeDynamicMcpConfig?: (config: Record<string, ScopedMcpServerConfig>) => void;
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
function IDECommandFlow({
  availableIDEs,
  unavailableIDEs,
  currentIDE,
  dynamicMcpConfig,
  onChangeDynamicMcpConfig,
  onDone
}: IDECommandFlowProps): React.ReactNode {
  const [connectingIDE, setConnectingIDE] = useState<DetectedIDEInfo | null>(null);
  const ideClient = useAppState(s => s.mcp.clients.find(c => c.name === 'ide'));
  const setAppState = useSetAppState();
  const isFirstCheckRef = useRef(true);

  // Watch for connection result
  useEffect(() => {
    if (!connectingIDE) return;
    // Skip the first check — it reflects stale state from before the
    // config change was dispatched
    if (isFirstCheckRef.current) {
      isFirstCheckRef.current = false;
      return;
    }
    if (!ideClient || ideClient.type === 'pending') return;
    if (ideClient.type === 'connected') {
      onDone(`Підключено до ${connectingIDE.name}.`);
    } else if (ideClient.type === 'failed') {
      onDone(`Не вдалося підключитися до ${connectingIDE.name}.`);
    }
  }, [ideClient, connectingIDE, onDone]);

  // Timeout fallback
  useEffect(() => {
    if (!connectingIDE) return;
    const timer = setTimeout(onDone, IDE_CONNECTION_TIMEOUT_MS, `Час підключення до ${connectingIDE.name} вичерпано.`);
    return () => clearTimeout(timer);
  }, [connectingIDE, onDone]);
  const handleSelectIDE = useCallback((selectedIDE?: DetectedIDEInfo) => {
    if (!onChangeDynamicMcpConfig) {
      onDone('Помилка підключення до IDE.');
      return;
    }
    const newConfig = {
      ...(dynamicMcpConfig || {})
    };
    if (currentIDE) {
      delete newConfig.ide;
    }
    if (!selectedIDE) {
      // Close the MCP transport and remove the client from state
      if (ideClient && ideClient.type === 'connected' && currentIDE) {
        // Null out onclose to prevent auto-reconnection
        ideClient.client.onclose = () => {};
        void clearServerCache('ide', ideClient.config);
        setAppState(prev => ({
          ...prev,
          mcp: {
            ...prev.mcp,
            clients: prev.mcp.clients.filter(c_0 => c_0.name !== 'ide'),
            tools: prev.mcp.tools.filter(t => !t.name?.startsWith('mcp__ide__')),
            commands: prev.mcp.commands.filter(c_1 => !c_1.name?.startsWith('mcp__ide__'))
          }
        }));
      }
      onChangeDynamicMcpConfig(newConfig);
      onDone(currentIDE ? `Відключено від ${currentIDE.name}.` : 'IDE не обрано.');
      return;
    }
    const url = selectedIDE.url;
    newConfig.ide = {
      type: url.startsWith('ws:') ? 'ws-ide' : 'sse-ide',
      url: url,
      ideName: selectedIDE.name,
      authToken: selectedIDE.authToken,
      ideRunningInWindows: selectedIDE.ideRunningInWindows,
      scope: 'dynamic' as const
    } as ScopedMcpServerConfig;
    isFirstCheckRef.current = true;
    setConnectingIDE(selectedIDE);
    onChangeDynamicMcpConfig(newConfig);
  }, [dynamicMcpConfig, currentIDE, ideClient, setAppState, onChangeDynamicMcpConfig, onDone]);
  if (connectingIDE) {
    return <Text dimColor>Підключення до {connectingIDE.name}…</Text>;
  }
  return <IDEScreen availableIDEs={availableIDEs} unavailableIDEs={unavailableIDEs} selectedIDE={currentIDE} onClose={() => onDone('Вибір IDE скасовано', {
    display: 'system'
  })} onSelect={handleSelectIDE} />;
}

/**
 * Formats workspace folders for display, stripping cwd and showing tail end of paths
 * @param folders Array of folder paths
 * @param maxLength Maximum total length of the formatted string
 * @returns Formatted string with folder paths
 */
export function formatWorkspaceFolders(folders: string[], maxLength: number = 100): string {
  if (folders.length === 0) return '';
  const cwd = getCwd();

  // Only show first 2 workspaces
  const foldersToShow = folders.slice(0, 2);
  const hasMore = folders.length > 2;

  // Account for ", …" if there are more folders
  const ellipsisOverhead = hasMore ? 3 : 0; // ", …"

  // Account for commas and spaces between paths (", " = 2 chars per separator)
  const separatorOverhead = (foldersToShow.length - 1) * 2;
  const availableLength = maxLength - separatorOverhead - ellipsisOverhead;
  const maxLengthPerPath = Math.floor(availableLength / foldersToShow.length);
  const cwdNFC = cwd.normalize('NFC');
  const formattedFolders = foldersToShow.map(folder => {
    // Strip cwd from the beginning if present
    // Normalize both to NFC for consistent comparison (macOS uses NFD paths)
    const folderNFC = folder.normalize('NFC');
    if (folderNFC.startsWith(cwdNFC + path.sep)) {
      folder = folderNFC.slice(cwdNFC.length + 1);
    }
    if (folder.length <= maxLengthPerPath) {
      return folder;
    }
    return '…' + folder.slice(-(maxLengthPerPath - 1));
  });
  let result = formattedFolders.join(', ');
  if (hasMore) {
    result += ', …';
  }
  return result;
}
