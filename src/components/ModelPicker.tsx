import capitalize from 'lodash-es/capitalize.js'
import * as React from 'react'
import { useExitOnCtrlCDWithKeybindings } from 'src/hooks/useExitOnCtrlCDWithKeybindings.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  FAST_MODE_MODEL_DISPLAY,
  isFastModeAvailable,
  isFastModeCooldown,
  isFastModeEnabled,
} from 'src/utils/fastMode.js'
import { Box, Text } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import type { AppState } from '../state/AppState.js'
import { useAppState, useSetAppState } from '../state/AppState.js'
import {
  convertEffortValueToLevel,
  type EffortLevel,
  getDefaultEffortForModel,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  resolvePickerEffortPersistence,
  toPersistableEffort,
} from '../utils/effort.js'
import {
  getDefaultMainLoopModel,
  type ModelSetting,
  modelDisplayString,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import {
  getModelOptions,
  type ModelOption,
} from '../utils/model/modelOptions.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'
import { effortLevelToSymbol } from './EffortIndicator.js'

export type ModelPickerDiscoveryState = {
  message: string
  tone?: 'info' | 'success' | 'warning' | 'error'
}

export type Props = {
  initial: string | null
  sessionModel?: ModelSetting
  onSelect: (model: string | null, effort: EffortLevel | undefined) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
  showFastModeNotice?: boolean
  /** Overrides the dim header line below "Select model". */
  headerText?: string
  /**
   * When true, skip writing effortLevel to userSettings on selection.
   * Used by the assistant installer wizard where the model choice is
   * project-scoped (written to the assistant's .claude/settings.json via
   * install.ts) and should not leak to the user's global ~/.claude/settings.
   */
  skipSettingsWrite?: boolean
  optionsOverride?: ModelOption[]
  discoveryState?: ModelPickerDiscoveryState
  onRefresh?: () => void
}

const NO_PREFERENCE = '__NO_PREFERENCE__'

function mapDiscoveryToneToColor(
  tone: ModelPickerDiscoveryState['tone'],
): 'error' | 'warning' | 'success' | 'subtle' {
  switch (tone) {
    case 'error':
      return 'error'
    case 'warning':
      return 'warning'
    case 'success':
      return 'success'
    case 'info':
    default:
      return 'subtle'
  }
}

export function ModelPicker({
  initial,
  sessionModel,
  onSelect,
  onCancel,
  isStandaloneCommand,
  showFastModeNotice,
  headerText,
  skipSettingsWrite,
  optionsOverride,
  discoveryState,
  onRefresh,
}: Props) {
  const setAppState = useSetAppState()
  const exitState = useExitOnCtrlCDWithKeybindings()
  const initialValue = initial === null ? NO_PREFERENCE : initial
  const [focusedValue, setFocusedValue] = React.useState(initialValue)
  const isFastMode = useAppState((s: AppState) =>
    isFastModeEnabled() ? s.fastMode : false,
  )
  const [hasToggledEffort, setHasToggledEffort] = React.useState(false)
  const effortValue = useAppState((s: AppState) => s.effortValue)
  const [effort, setEffort] = React.useState<EffortLevel | undefined>(
    effortValue !== undefined ? convertEffortValueToLevel(effortValue) : undefined,
  )

  const modelOptions = optionsOverride ?? getModelOptions(isFastMode ?? false)
  const optionsWithInitial =
    initial !== null && !modelOptions.some(opt => opt.value === initial)
      ? [
          ...modelOptions,
          {
            value: initial,
            label: modelDisplayString(initial),
            description: 'Current model',
          },
        ]
      : modelOptions

  const selectOptions = optionsWithInitial.map(opt => ({
    ...opt,
    value: opt.value === null ? NO_PREFERENCE : opt.value,
  }))
  const initialFocusValue = selectOptions.some(opt => opt.value === initialValue)
    ? initialValue
    : (selectOptions[0]?.value ?? undefined)
  const visibleCount = Math.min(10, selectOptions.length)
  const hiddenCount = Math.max(0, selectOptions.length - visibleCount)
  const focusedModelName = selectOptions.find(opt => opt.value === focusedValue)?.label
  const focusedModel = resolveOptionModel(focusedValue)
  const focusedSupportsEffort = focusedModel ? modelSupportsEffort(focusedModel) : false
  const focusedSupportsMax = focusedModel ? modelSupportsMaxEffort(focusedModel) : false
  const focusedDefaultEffort = getDefaultEffortLevelForOption(focusedValue)
  const displayEffort =
    effort === 'max' && !focusedSupportsMax ? 'high' : effort

  useKeybindings(
    {
      'modelPicker:decreaseEffort': () => {
        if (!focusedSupportsEffort) {
          return
        }
        setEffort(prev =>
          cycleEffortLevel(
            prev ?? focusedDefaultEffort,
            'left',
            focusedSupportsMax,
          ),
        )
        setHasToggledEffort(true)
      },
      'modelPicker:increaseEffort': () => {
        if (!focusedSupportsEffort) {
          return
        }
        setEffort(prev =>
          cycleEffortLevel(
            prev ?? focusedDefaultEffort,
            'right',
            focusedSupportsMax,
          ),
        )
        setHasToggledEffort(true)
      },
      ...(onRefresh
        ? {
            'modelPicker:refresh': () => onRefresh(),
          }
        : {}),
    },
    { context: 'ModelPicker' },
  )

  const handleFocus = (value: string) => {
    setFocusedValue(value)
    if (!hasToggledEffort && effortValue === undefined) {
      setEffort(getDefaultEffortLevelForOption(value))
    }
  }

  const handleSelect = (value: string) => {
    logEvent('tengu_model_command_menu_effort', {
      effort: effort as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    if (!skipSettingsWrite) {
      const effortLevel = resolvePickerEffortPersistence(
        effort,
        getDefaultEffortLevelForOption(value),
        getSettingsForSource('userSettings')?.effortLevel,
        hasToggledEffort,
      )
      const persistable = toPersistableEffort(effortLevel)
      if (persistable !== undefined) {
        updateSettingsForSource('userSettings', {
          effortLevel: persistable,
        })
      }
      setAppState(prev => ({
        ...prev,
        effortValue: effortLevel,
      }))
    }

    const selectedModel = resolveOptionModel(value)
    const selectedEffort =
      hasToggledEffort && selectedModel && modelSupportsEffort(selectedModel)
        ? effort
        : undefined

    if (value === NO_PREFERENCE) {
      onSelect(null, selectedEffort)
      return
    }

    onSelect(value, selectedEffort)
  }
  const refreshHint = onRefresh ? (
    <ConfigurableShortcutHint
      action="modelPicker:refresh"
      context="ModelPicker"
      fallback="r"
      description="refresh models"
    />
  ) : null

  const content = (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Text color="remember" bold>
          Select model
        </Text>
        <Text dimColor>
          {headerText ??
            'Switch between Claude models. Applies to this session and future Claude Code sessions. For other/previous model names, specify with --model.'}
        </Text>
        {sessionModel ? (
          <Text dimColor>
            Currently using {modelDisplayString(sessionModel)} for this session
            {' '} (set by plan mode). Selecting a model will undo this.
          </Text>
        ) : null}
        {discoveryState ? (
          <Text color={mapDiscoveryToneToColor(discoveryState.tone)}>
            {discoveryState.message}
            {refreshHint ? <Text color="subtle"> {' '}· {refreshHint}</Text> : null}
          </Text>
        ) : refreshHint ? (
          <Text dimColor>{refreshHint}</Text>
        ) : null}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="column">
          <Select
            defaultValue={initialValue}
            defaultFocusValue={initialFocusValue}
            options={selectOptions}
            onChange={handleSelect}
            onFocus={handleFocus}
            onCancel={onCancel ?? (() => {})}
            visibleOptionCount={visibleCount}
          />
        </Box>
        {hiddenCount > 0 ? (
          <Box paddingLeft={3}>
            <Text dimColor>and {hiddenCount} more…</Text>
          </Box>
        ) : null}
      </Box>

      <Box marginBottom={1} flexDirection="column">
        {focusedSupportsEffort ? (
          <Text dimColor>
            <EffortLevelIndicator effort={displayEffort} />{' '}
            {capitalize(displayEffort)} effort
            {displayEffort === focusedDefaultEffort ? ' (default)' : ''}{' '}
            <Text color="subtle">← → to adjust</Text>
          </Text>
        ) : (
          <Text color="subtle">
            <EffortLevelIndicator effort={undefined} /> Effort not supported
            {focusedModelName ? ` for ${focusedModelName}` : ''}
          </Text>
        )}
      </Box>

      {isFastModeEnabled() ? (
        showFastModeNotice ? (
          <Box marginBottom={1}>
            <Text dimColor>
              Fast mode is <Text bold>ON</Text> and available with{' '}
              {FAST_MODE_MODEL_DISPLAY} only (/fast). Switching to other models
              turn off fast mode.
            </Text>
          </Box>
        ) : isFastModeAvailable() && !isFastModeCooldown() ? (
          <Box marginBottom={1}>
            <Text dimColor>
              Use <Text bold>/fast</Text> to turn on Fast mode (
              {FAST_MODE_MODEL_DISPLAY} only).
            </Text>
          </Box>
        ) : null
      ) : null}

      {isStandaloneCommand ? (
        <Text dimColor italic>
          {exitState.pending ? (
            <>Press {exitState.keyName} again to exit</>
          ) : (
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              {refreshHint}
              <ConfigurableShortcutHint
                action="select:cancel"
                context="Select"
                fallback="Esc"
                description="exit"
              />
            </Byline>
          )}
        </Text>
      ) : null}
    </Box>
  )

  if (!isStandaloneCommand) {
    return content
  }

  return <Pane color="permission">{content}</Pane>
}

function resolveOptionModel(value?: string): string | undefined {
  if (!value) return undefined
  return value === NO_PREFERENCE
    ? getDefaultMainLoopModel()
    : parseUserSpecifiedModel(value)
}

function EffortLevelIndicator({
  effort,
}: {
  effort: EffortLevel | undefined
}) {
  return (
    <Text color={effort ? 'claude' : 'subtle'}>
      {effortLevelToSymbol(effort ?? 'low')}
    </Text>
  )
}

function cycleEffortLevel(
  current: EffortLevel,
  direction: 'left' | 'right',
  includeMax: boolean,
): EffortLevel {
  const levels: EffortLevel[] = includeMax
    ? ['low', 'medium', 'high', 'max']
    : ['low', 'medium', 'high']
  const idx = levels.indexOf(current)
  const currentIndex = idx !== -1 ? idx : levels.indexOf('high')

  if (direction === 'right') {
    return levels[(currentIndex + 1) % levels.length]!
  }

  return levels[(currentIndex - 1 + levels.length) % levels.length]!
}

function getDefaultEffortLevelForOption(value?: string): EffortLevel {
  const resolved = resolveOptionModel(value) ?? getDefaultMainLoopModel()
  const defaultValue = getDefaultEffortForModel(resolved)
  return defaultValue !== undefined
    ? convertEffortValueToLevel(defaultValue)
    : 'high'
}
