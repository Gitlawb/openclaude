import * as React from 'react'
import { Box, Text } from '../ink.js'
import {
  convertEffortValueToLevel,
  getAvailableEffortLevels,
  getDefaultEffortForModel,
  getEffortLevelDescription,
  getEffortLevelLabel,
  modelSupportsEffort,
  OPENAI_EFFORT_LEVELS,
  type EffortValue,
} from '../utils/effort.js'
import type { ModelSetting } from '../utils/model/model.js'
import {
  getModelOptionsForProvider,
  type ModelOption,
} from '../utils/model/modelOptions.js'
import {
  getPersistedEffortSettingForProvider,
} from '../utils/model/providerModelSettings.js'
import {
  getDefaultModelSettingForTarget,
  getProviderSelectionTargetOptions,
  resolveModelSettingForTarget,
  resolveProviderSelectionTargetOption,
  type ProviderSelectionTargetOption,
} from '../utils/model/providerTargets.js'
import { getSettingsForSource } from '../utils/settings/settings.js'
import { Select } from './CustomSelect/index.js'
import { Pane } from './design-system/Pane.js'

const DEFAULT_MODEL_VALUE = '__DEFAULT_MODEL__'
const AUTO_EFFORT_VALUE = '__AUTO_EFFORT__'

type PickerStep = 'target' | 'model' | 'effort'

type TargetDraftSelection = {
  model: ModelSetting
  effort: EffortValue | undefined
}

export type InferenceSelection = {
  targetKey: string
  model: ModelSetting
  effort: EffortValue | undefined
}

type Props = {
  initialTargetKey: string
  initialModel: ModelSetting
  initialEffort: EffortValue | undefined
  onSelect: (selection: InferenceSelection) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
}

function buildInitialTargetSelection(
  target: ProviderSelectionTargetOption,
  initialTargetKey: string,
  initialModel: ModelSetting,
  initialEffort: EffortValue | undefined,
): TargetDraftSelection {
  if (target.targetKey === initialTargetKey) {
    return {
      model: initialModel,
      effort: initialEffort,
    }
  }

  const userSettings = getSettingsForSource('userSettings') || {}
  return {
    model: getDefaultModelSettingForTarget(target, userSettings),
    effort: getPersistedEffortSettingForProvider({
      settings: userSettings,
      targetKey: target.targetKey,
    }),
  }
}

function buildModelOptionsForTarget(
  target: ProviderSelectionTargetOption,
  selectedModel: ModelSetting,
): ModelOption[] {
  const userSettings = getSettingsForSource('userSettings') || {}
  const options = [...getModelOptionsForProvider(target.provider)]
  const explicitModel =
    selectedModel ?? getDefaultModelSettingForTarget(target, userSettings)

  if (
    explicitModel !== null &&
    explicitModel !== undefined &&
    explicitModel.trim() !== '' &&
    !options.some(option => option.value === explicitModel)
  ) {
    options.push({
      value: explicitModel,
      label: explicitModel,
      description:
        target.kind === 'profile' ? 'Profile model' : 'Currently configured model',
    })
  }

  const seen = new Set<string>()
  return options.filter(option => {
    const key = String(option.value)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function getDefaultEffortForTargetModel(
  target: ProviderSelectionTargetOption,
  model: string,
): EffortValue | undefined {
  if (target.provider === 'codex' || target.provider === 'openai') {
    return 'high'
  }
  return getDefaultEffortForModel(model)
}

function buildEffortOptionsForTarget(
  target: ProviderSelectionTargetOption,
  model: string,
) {
  if (target.provider === 'codex' || target.provider === 'openai') {
    return {
      supportsEffort: true,
      levels: [...OPENAI_EFFORT_LEVELS],
    }
  }

  if (target.provider !== 'firstParty' || !modelSupportsEffort(model)) {
    return {
      supportsEffort: false,
      levels: [] as string[],
    }
  }

  return {
    supportsEffort: true,
    levels: getAvailableEffortLevels(model).map(level => String(level)),
  }
}

function getSelectedModelLabel(
  options: ModelOption[],
  model: ModelSetting,
): string {
  if (model === null) {
    return 'Default'
  }
  return options.find(option => option.value === model)?.label ?? String(model)
}

export function InferenceSelectionPicker({
  initialTargetKey,
  initialModel,
  initialEffort,
  onSelect,
  onCancel,
  isStandaloneCommand,
}: Props): React.ReactNode {
  const targetOptions = React.useMemo(
    () => getProviderSelectionTargetOptions(),
    [],
  )

  const [step, setStep] = React.useState<PickerStep>('target')
  const [activeTargetKey, setActiveTargetKey] = React.useState(initialTargetKey)
  const [selectionByTarget, setSelectionByTarget] = React.useState<
    Record<string, TargetDraftSelection>
  >(() => {
    const activeTarget =
      resolveProviderSelectionTargetOption(initialTargetKey) ??
      targetOptions[0]

    if (!activeTarget) {
      return {}
    }

    return {
      [activeTarget.targetKey]: buildInitialTargetSelection(
        activeTarget,
        initialTargetKey,
        initialModel,
        initialEffort,
      ),
    }
  })

  const activeTarget =
    resolveProviderSelectionTargetOption(activeTargetKey) ?? targetOptions[0]

  if (!activeTarget) {
    return null
  }

  const activeSelection =
    selectionByTarget[activeTarget.targetKey] ??
    buildInitialTargetSelection(
      activeTarget,
      initialTargetKey,
      initialModel,
      initialEffort,
    )

  const modelOptions = buildModelOptionsForTarget(activeTarget, activeSelection.model)
  const resolvedModel = resolveModelSettingForTarget(
    activeTarget,
    activeSelection.model,
  )
  const effortConfig = buildEffortOptionsForTarget(activeTarget, resolvedModel)
  const defaultEffort = getDefaultEffortForTargetModel(activeTarget, resolvedModel)
  const selectedModelLabel = getSelectedModelLabel(
    modelOptions,
    activeSelection.model,
  )

  const setTargetSelection = React.useCallback(
    (
      targetKey: string,
      update: Partial<TargetDraftSelection>,
      targetOverride?: ProviderSelectionTargetOption,
    ): void => {
      setSelectionByTarget(prev => {
        const resolvedTarget =
          targetOverride ?? resolveProviderSelectionTargetOption(targetKey)
        if (!resolvedTarget) {
          return prev
        }

        const current =
          prev[targetKey] ??
          buildInitialTargetSelection(
            resolvedTarget,
            initialTargetKey,
            initialModel,
            initialEffort,
          )

        return {
          ...prev,
          [targetKey]: {
            ...current,
            ...update,
          },
        }
      })
    },
    [initialEffort, initialModel, initialTargetKey],
  )

  function renderHeader(
    title: string,
    subtitle: string,
  ): React.ReactNode {
    return (
      <Box marginBottom={1} flexDirection="column">
        <Text color="remember" bold={true}>{title}</Text>
        <Text dimColor={true}>{subtitle}</Text>
      </Box>
    )
  }

  function handleTargetCancel(): void {
    onCancel?.()
  }

  function handleModelCancel(): void {
    setStep('target')
  }

  function handleEffortCancel(): void {
    setStep('model')
  }

  function commitSelection(effort: EffortValue | undefined): void {
    setTargetSelection(activeTarget.targetKey, { effort })
    onSelect({
      targetKey: activeTarget.targetKey,
      model: activeSelection.model,
      effort,
    })
  }

  let content: React.ReactNode

  if (step === 'target') {
    content = (
      <Box flexDirection="column">
        {renderHeader(
          'Select Provider',
          'Step 1 of 3. Choose the inference target that /model should control.',
        )}
        <Select
          options={targetOptions.map(option => ({
            value: option.targetKey,
            label: option.label,
            description: option.description,
          }))}
          defaultValue={activeTarget.targetKey}
          visibleOptionCount={Math.min(8, targetOptions.length)}
          onChange={value => {
            const nextTarget =
              resolveProviderSelectionTargetOption(value) ?? activeTarget
            setActiveTargetKey(nextTarget.targetKey)
            setTargetSelection(nextTarget.targetKey, {}, nextTarget)
            setStep('model')
          }}
          onCancel={handleTargetCancel}
        />
      </Box>
    )
  } else if (step === 'model') {
    content = (
      <Box flexDirection="column">
        {renderHeader(
          'Select Model',
          `Step 2 of 3. Provider: ${activeTarget.label}. Choose the default model for this target.`,
        )}
        <Select
          options={modelOptions.map(option => ({
            value: option.value === null ? DEFAULT_MODEL_VALUE : option.value,
            label: option.label,
            description: option.description,
          }))}
          defaultValue={
            activeSelection.model === null
              ? DEFAULT_MODEL_VALUE
              : String(activeSelection.model)
          }
          visibleOptionCount={Math.min(10, modelOptions.length)}
          onChange={value => {
            const model = value === DEFAULT_MODEL_VALUE ? null : value
            setTargetSelection(activeTarget.targetKey, { model })
            setStep('effort')
          }}
          onCancel={handleModelCancel}
        />
      </Box>
    )
  } else {
    const currentEffort =
      activeSelection.effort === undefined
        ? AUTO_EFFORT_VALUE
        : String(activeSelection.effort)
    const autoLabel =
      defaultEffort !== undefined
        ? `Auto (currently ${getEffortLevelLabel(convertEffortValueToLevel(defaultEffort))})`
        : 'Auto'
    const effortOptions = [
      {
        value: AUTO_EFFORT_VALUE,
        label: autoLabel,
        description: 'Use the provider default for this model',
      },
      ...(effortConfig.supportsEffort
        ? effortConfig.levels.map(level => ({
            value: level,
            label: getEffortLevelLabel(level as any),
            description: getEffortLevelDescription(level as any),
          }))
        : []),
    ]

    content = (
      <Box flexDirection="column">
        {renderHeader(
          'Select Effort',
          `Step 3 of 3. ${activeTarget.label} · ${selectedModelLabel}`,
        )}
        {!effortConfig.supportsEffort && (
          <Box marginBottom={1}>
            <Text dimColor={true}>
              This target does not expose configurable effort. Auto will be used.
            </Text>
          </Box>
        )}
        <Select
          options={effortOptions}
          defaultValue={currentEffort}
          visibleOptionCount={Math.min(6, effortOptions.length)}
          inlineDescriptions={true}
          onChange={value => {
            commitSelection(
              value === AUTO_EFFORT_VALUE ? undefined : (value as EffortValue),
            )
          }}
          onCancel={handleEffortCancel}
        />
      </Box>
    )
  }

  const wrapper = (
    <Box flexDirection="column">
      {content}
      <Box marginTop={1}>
        <Text dimColor={true}>
          {step === 'target'
            ? 'Enter confirm · Esc cancel'
            : 'Enter confirm · Esc back'}
        </Text>
      </Box>
    </Box>
  )

  if (!isStandaloneCommand) {
    return wrapper
  }

  return <Pane color="permission">{wrapper}</Pane>
}
