import { useEffect, useState } from 'react';
import { c as _c } from "react-compiler-runtime";
import { Box, Text } from '../../ink.js';
import { getAnthropicApiKey, getSubscriptionType } from '../../utils/auth.js';
import { getAgentModelOptions } from '../../utils/model/agent.js';
import { Select } from '../CustomSelect/select.js';

interface ModelSelectorProps {
  initialModel?: string;
  onComplete: (model?: string) => void;
  onCancel?: () => void;
}

interface ModelValidationState {
  isValid: boolean;
  isLoading: boolean;
  error?: string;
  planType?: string;
}

export function ModelSelector(t0: ModelSelectorProps) {
  const $ = _c(11);
  const {
    initialModel,
    onComplete,
    onCancel
  } = t0;

  const [validation, setValidation] = useState<ModelValidationState>({
    isValid: true,
    isLoading: false,
  });

  useEffect(() => {
    async function validateApiKey() {
      setValidation(prev => ({ ...prev, isLoading: true }));

      try {
        const apiKey = getAnthropicApiKey();
        // const hasValidKey = apiKey !== null;
        // const isSubscriber = isClaudeAISubscriber();
        const hasValidKey = apiKey !== null && apiKey.length > 0;

        let planType = 'free';
        let error: string | undefined;

        if (hasValidKey) {
          try {
            const subscriptionType = getSubscriptionType();
            planType = subscriptionType || 'free';
          } catch {
            // If we can't get subscription type, still allow the key
            planType = 'unknown';
          }
        } else {
          error = 'No valid API key found. Please configure your API key.';
        }

        setValidation({
          isValid: hasValidKey,
          isLoading: false,
          // planType: subscriptionType || 'free',
          // error: hasValidKey ? undefined : 'No valid API key found. Please configure your API key.',
          planType,
          error,
        });
      } catch (error) {
        setValidation({
          isValid: false,
          isLoading: false,
          error: 'Failed to validate API key',
        });
      }
    }

    validateApiKey();
  }, []);

  let t1;
  if ($[0] !== initialModel) {
    bb0: {
      const base = getAgentModelOptions();
      if (initialModel && !base.some(o => o.value === initialModel)) {
        t1 = [{
          value: initialModel,
          label: initialModel,
          description: "Current model (custom ID)"
        }, ...base];
        break bb0;
      }
      t1 = base;
    }
    $[0] = initialModel;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const modelOptions = t1;
  const defaultModel = initialModel ?? "sonnet";

  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Box marginBottom={1}><Text dimColor={true}>Model determines the agent's reasoning capabilities and speed.</Text></Box>;
    $[2] = t2;
  } else {
    t2 = $[2];
  }

  let t5;
  if ($[3] !== validation.error || $[4] !== validation.isLoading || $[5] !== validation.isValid || $[6] !== validation.planType) {
    t5 = <Box marginBottom={1}>
      {validation.isLoading ? (
        <Text dimColor={true}>Validating API key...</Text>
      ) : validation.error ? (
        <Text color="red">{validation.error}</Text>
      ) : (
        <Text dimColor={true}>
          API key valid • Plan: {validation.planType || 'free'}
        </Text>
      )}
    </Box>;
    $[3] = validation.error;
    $[4] = validation.isLoading;
    $[5] = validation.isValid;
    $[6] = validation.planType;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  // TODO: Add validation message

  let t3;
  if ($[8] !== onCancel || $[9] !== onComplete) {
    t3 = () => onCancel ? onCancel() : onComplete(undefined);
    $[8] = onCancel;
    $[9] = onComplete;
    $[10] = t3;
  } else {
    t3 = $[10];
  }

  let t4;
  // if ($[6] !== defaultModel || $[7] !== modelOptions || $[8] !== onComplete || $[9] !== t3) {
  //   t4 = <Box flexDirection="column">{t2}<Select options={modelOptions} defaultValue={defaultModel} onChange={onComplete} onCancel={t3} /></Box>;
  //   $[6] = defaultModel;
  //   $[7] = modelOptions;
  //   $[8] = onComplete;
  //   $[9] = t3;
  //   $[10] = t4;
  if ($[11] !== defaultModel || $[12] !== modelOptions || $[13] !== onComplete || $[14] !== t3 || $[15] !== validation.isValid) {
    t4 = <Box flexDirection="column">{t2}{t5}{validation.isValid ? <Select options={modelOptions} defaultValue={defaultModel} onChange={onComplete} onCancel={t3} isDisabled={!validation.isValid} /> : <Text color="yellow">Please configure a valid API key to select a model.</Text>}</Box>;
    $[11] = defaultModel;
    $[12] = modelOptions;
    $[13] = onComplete;
    $[14] = t3;
    $[15] = validation.isValid;
    $[16] = t4;
  } else {
    t4 = $[16];
  }
  return t4;
}
