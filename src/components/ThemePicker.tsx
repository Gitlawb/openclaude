import { feature } from 'bun:bundle';
import type { StructuredPatchHunk } from 'diff';
import * as React from 'react';
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box, Text, usePreviewTheme, useTheme, useThemeSetting } from '../ink.js';
import { useRegisterKeybindingContext } from '../keybindings/KeybindingContext.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import type { AppState } from '../state/AppStateStore.js';
import { gracefulShutdown } from '../utils/gracefulShutdown.js';
import { updateSettingsForSource } from '../utils/settings/settings.js';
import type { ThemeSetting } from '../utils/theme.js';
import { Select } from './CustomSelect/index.js';
import { Byline } from './design-system/Byline.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { getColorModuleUnavailableReason, getSyntaxTheme } from './StructuredDiff/colorDiff.js';
import { StructuredDiff } from './StructuredDiff.js';

type StructuredDiffComponent = React.ComponentType<{
  patch: StructuredPatchHunk
  dim: boolean
  filePath: string
  firstLine: string | null
  width: number
  skipHighlighting?: boolean
}>
const StructuredDiffView = StructuredDiff as StructuredDiffComponent

export type ThemePickerProps = {
  onThemeSelect: (setting: ThemeSetting) => void;
  showIntroText?: boolean;
  helpText?: string;
  showHelpTextBelow?: boolean;
  hideEscToCancel?: boolean;
  /** Skip exit handling when running in a context that already has it (e.g., onboarding) */
  skipExitHandling?: boolean;
  /** Called when the user cancels (presses Escape). If skipExitHandling is true and this is provided, it will be called instead of just saving the preview. */
  onCancel?: () => void;
}

const DEMO_PATCH: StructuredPatchHunk = {
  oldStart: 1,
  newStart: 1,
  oldLines: 3,
  newLines: 3,
  lines: [
    ' function greet() {',
    '-  console.log("Hello, World!");',
    '+  console.log("Hello, Neural Network!");',
    ' }',
  ],
}

/**
 * Theme chooser with live preview. Implemented without react-compiler `_c` memo
 * caches so preview/subtree reconciliation cannot stick on stale element refs when
 * `setPreviewTheme` updates the resolved palette.
 */
export function ThemePicker({
  onThemeSelect,
  showIntroText = false,
  helpText = '',
  showHelpTextBelow = false,
  hideEscToCancel = false,
  skipExitHandling = false,
  onCancel: onCancelProp,
}: ThemePickerProps) {
  const [theme] = useTheme();
  const themeSetting = useThemeSetting();
  const { columns } = useTerminalSize();
  const colorModuleUnavailableReason = React.useMemo(
    () => getColorModuleUnavailableReason(),
    [],
  )
  const syntaxTheme =
    colorModuleUnavailableReason === null ? getSyntaxTheme(theme) : null
  const { setPreviewTheme, savePreview, cancelPreview } = usePreviewTheme()
  const syntaxHighlightingDisabled = useAppState(
    (s: AppState) => s.settings.syntaxHighlightingDisabled ?? false
  );
  const setAppState = useSetAppState();
  useRegisterKeybindingContext("ThemePicker", true);
  const syntaxToggleShortcut = useShortcutDisplay("theme:toggleSyntaxHighlighting", "ThemePicker", "ctrl+t");

  const toggleSyntax = React.useCallback(() => {
    if (colorModuleUnavailableReason === null) {
      const newValue = !syntaxHighlightingDisabled
      updateSettingsForSource("userSettings", {
        syntaxHighlightingDisabled: newValue
      });
      setAppState(prev => ({
        ...prev,
        settings: {
          ...prev.settings,
          syntaxHighlightingDisabled: newValue
        }
      }));
    }
  }, [
    colorModuleUnavailableReason,
    syntaxHighlightingDisabled,
    setAppState,
  ])

  useKeybinding("theme:toggleSyntaxHighlighting", toggleSyntax, {
    context: "ThemePicker",
  })

  const exitState = useExitOnCtrlCDWithKeybindings(
    skipExitHandling ? () => {} : undefined,
  )

  const themeOptions = React.useMemo(
    () => [
      ...(feature("AUTO_THEME")
        ? [{ label: "Авто (відповідно до терміналу)", value: "auto" as const }]
        : []), {
        label: "Вогонь (захід — типова Нейромережі)",
        value: "fire" as const
      }, {
        label: "Темний режим",
        value: "dark" as const
      }, {
        label: "Світлий режим",
        value: "light" as const
      }, {
        label: "Темний режим (для дальтоніків)",
        value: "dark-daltonized" as const,
      }, {
        label: "Світлий режим (для дальтоніків)",
        value: "light-daltonized" as const,
      }, {
        label: "Темний режим (лише ANSI кольори)",
        value: "dark-ansi" as const
      }, {
        label: "Світлий режим (лише ANSI кольори)",
        value: "light-ansi" as const
      },],
    [],
  )

  const handleRowFocus = React.useCallback(
    (setting: ThemeSetting) => {
      setPreviewTheme(setting)
    },
    [setPreviewTheme],
  )

  const handleSelect = React.useCallback(
    (setting: ThemeSetting) => {
      savePreview()
      onThemeSelect(setting)
    },
    [savePreview, onThemeSelect],
  )

  const handleCancel = React.useCallback(() => {
    cancelPreview()
    if (skipExitHandling) {
      onCancelProp?.()
    } else {
      void gracefulShutdown(0)
    }
  }, [cancelPreview, onCancelProp, skipExitHandling])

  const syntaxHint =
    colorModuleUnavailableReason === 'env'
      ? `Підсвічування синтаксису вимкнено (через CLAUDE_CODE_SYNTAX_HIGHLIGHT=${process.env.CLAUDE_CODE_SYNTAX_HIGHLIGHT})`
      : syntaxHighlightingDisabled
        ? `Підсвічування синтаксису вимкнено (${syntaxToggleShortcut} щоб увімкнути)`
        : syntaxTheme
          ? `Тема синтаксису: ${syntaxTheme.theme}${syntaxTheme.source ? ` (з ${syntaxTheme.source})` : ''} (${syntaxToggleShortcut} щоб вимкнути)`
          : `Підсвічування синтаксису увімкнено (${syntaxToggleShortcut} щоб вимкнути)`

  const header = showIntroText ? (
    <Text>{"Почнімо."}</Text>
  ) : (
    <Text bold color="permission">
      Тема
    </Text>
  )

  const introBlock = (
    <Box flexDirection="column">
      <Text bold>Оберіть стиль тексту, який найкраще виглядає у вашому терміналі</Text>
      {helpText && !showHelpTextBelow ? (
        <Text dimColor>{helpText}</Text>
      ) : null}
    </Box>
  )

  const content = (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column" gap={1}>
        {header}
        {introBlock}
        <Select
          options={themeOptions}
          onFocus={handleRowFocus}
          onChange={handleSelect}
          onCancel={handleCancel}
          visibleOptionCount={themeOptions.length}
          defaultValue={themeSetting}
          defaultFocusValue={themeSetting}
        />
      </Box>
      <Box flexDirection="column" width="100%">
        <Box
          key={theme}
          flexDirection="column"
          borderTop
          borderBottom
          borderLeft={false}
          borderRight={false}
          borderStyle="dashed"
          borderColor="subtle"
        >
          <StructuredDiffView
            patch={DEMO_PATCH}
            dim={false}
            filePath="demo.js"
            firstLine={null}
            width={columns}
          />
        </Box>
        <Text dimColor>
          {' '}
          {syntaxHint}
        </Text>
      </Box>
    </Box>
  )

  if (!showIntroText) {
    return (
      <>
        <Box flexDirection="column">{content}</Box>
        {showHelpTextBelow && helpText ? (
          <Box marginLeft={3}>
            <Text dimColor>{helpText}</Text>
          </Box>
        ) : null}
        {!hideEscToCancel ? (
          <Box marginTop={1}>
            <Text dimColor italic>
              {exitState.pending ? (
                <>Натисніть {exitState.keyName} ще раз для виходу</>
              ) : (
                <Byline>
                  <KeyboardShortcutHint shortcut="Enter" action="обрати" />
                  <KeyboardShortcutHint shortcut="Esc" action="скасувати" />
                </Byline>
              )}
            </Text>
          </Box>
        ) : null}
      </>
    )
  }

  return content
}
