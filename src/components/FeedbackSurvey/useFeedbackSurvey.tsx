import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDynamicConfig } from 'src/hooks/useDynamicConfig.js';
import { isFeedbackSurveyDisabled } from 'src/services/analytics/config.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { isPolicyAllowed } from '../../services/policyLimits/index.js';
import type { Message } from '../../types/message.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { getLastAssistantMessage } from '../../utils/messages.js';
import { getMainLoopModel } from '../../utils/model/model.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { logOTelEvent } from '../../utils/telemetry/events.js';
import { submitTranscriptShare, type TranscriptShareTrigger } from './submitTranscriptShare.js';
import type { TranscriptShareResponse } from './TranscriptSharePrompt.js';
import { useSurveyState } from './useSurveyState.js';
import type { FeedbackSurveyResponse, FeedbackSurveyType } from './utils.js';
type FeedbackSurveyConfig = {
  minTimeBeforeFeedbackMs: number;
  minTimeBetweenFeedbackMs: number;
  minTimeBetweenGlobalFeedbackMs: number;
  minUserTurnsBeforeFeedback: number;
  minUserTurnsBetweenFeedback: number;
  hideThanksAfterMs: number;
  onForModels: string[];
  probability: number;
};
type TranscriptAskConfig = {
  probability: number;
};
const DEFAULT_FEEDBACK_SURVEY_CONFIG: FeedbackSurveyConfig = {
  minTimeBeforeFeedbackMs: 600000,
  minTimeBetweenFeedbackMs: 3600000,
  minTimeBetweenGlobalFeedbackMs: 100000000,
  minUserTurnsBeforeFeedback: 5,
  minUserTurnsBetweenFeedback: 10,
  hideThanksAfterMs: 3000,
  onForModels: ['*'],
  probability: 0.005
};
const DEFAULT_TRANSCRIPT_ASK_CONFIG: TranscriptAskConfig = {
  probability: 0
};
export function useFeedbackSurvey(messages: Message[], isLoading: boolean, submitCount: number, surveyType: FeedbackSurveyType = 'session', hasActivePrompt: boolean = false): {
  state: 'closed' | 'open' | 'thanks' | 'transcript_prompt' | 'submitting' | 'submitted';
  lastResponse: FeedbackSurveyResponse | null;
  handleSelect: (selected: FeedbackSurveyResponse) => boolean;
  handleTranscriptSelect: (selected: TranscriptShareResponse) => void;
} {
  const lastAssistantMessageIdRef = useRef('unknown');
  lastAssistantMessageIdRef.current = getLastAssistantMessage(messages)?.message?.id || 'unknown';
  const [feedbackSurvey, setFeedbackSurvey] = useState<{
    timeLastShown: number | null;
    submitCountAtLastAppearance: number | null;
  }>(() => ({
    timeLastShown: null,
    submitCountAtLastAppearance: null
  }));
  const config = useDynamicConfig<FeedbackSurveyConfig>('tengu_feedback_survey_config', DEFAULT_FEEDBACK_SURVEY_CONFIG);
  const badTranscriptAskConfig = useDynamicConfig<TranscriptAskConfig>('tengu_bad_survey_transcript_ask_config', DEFAULT_TRANSCRIPT_ASK_CONFIG);
  const goodTranscriptAskConfig = useDynamicConfig<TranscriptAskConfig>('tengu_good_survey_transcript_ask_config', DEFAULT_TRANSCRIPT_ASK_CONFIG);
  const settingsRate = getInitialSettings().feedbackSurveyRate;
  const sessionStartTime = useRef(Date.now());
  const submitCountAtSessionStart = useRef(submitCount);
  const submitCountRef = useRef(submitCount);
  submitCountRef.current = submitCount;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // Probability gate: roll once when eligibility conditions are met, not on every
  // useMemo re-evaluation. Without this, each dependency change (submitCount,
  // isLoading toggle, etc.) re-rolls Math.random(), making the survey almost
  // certain to appear after enough renders.
  const probabilityPassedRef = useRef(false);
  const lastEligibleSubmitCountRef = useRef<number | null>(null);
  const updateLastShownTime = useCallback((timestamp: number, submitCountValue: number) => {
    setFeedbackSurvey(prev => {
      if (prev.timeLastShown === timestamp && prev.submitCountAtLastAppearance === submitCountValue) {
        return prev;
      }
      return {
        timeLastShown: timestamp,
        submitCountAtLastAppearance: submitCountValue
      };
    });
    // Persist cross-session pacing state (previously done by onChangeAppState observer)
    if (getGlobalConfig().feedbackSurveyState?.lastShownTime !== timestamp) {
      saveGlobalConfig(current => ({
        ...current,
        feedbackSurveyState: {
          lastShownTime: timestamp
        }
      }));
    }
  }, []);
  const onOpen = useCallback((appearanceId: string) => {
    updateLastShownTime(Date.now(), submitCountRef.current);
    logEvent('tengu_feedback_survey_event', {
      event_type: 'appeared' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      last_assistant_message_id: lastAssistantMessageIdRef.current as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      survey_type: surveyType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    void logOTelEvent('feedback_survey', {
      event_type: 'appeared',
      appearance_id: appearanceId,
      survey_type: surveyType
    });
  }, [updateLastShownTime, surveyType]);
  const onSelect = useCallback((appearanceId_0: string, selected: FeedbackSurveyResponse) => {
    updateLastShownTime(Date.now(), submitCountRef.current);
    logEvent('tengu_feedback_survey_event', {
      event_type: 'responded' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId_0 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      response: selected as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      last_assistant_message_id: lastAssistantMessageIdRef.current as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      survey_type: surveyType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    void logOTelEvent('feedback_survey', {
      event_type: 'responded',
      appearance_id: appearanceId_0,
      response: selected,
      survey_type: surveyType
    });
  }, [updateLastShownTime, surveyType]);
  const shouldShowTranscriptPrompt = useCallback((selected_0: FeedbackSurveyResponse) => {
    // Only bad and good ratings trigger the transcript ask
    if (selected_0 !== 'bad' && selected_0 !== 'good') {
      return false;
    }

    // Don't show if user previously chose "Don't ask again"
    if (getGlobalConfig().transcriptShareDismissed) {
      return false;
    }

    // Don't show if product feedback is blocked by org policy (ZDR)
    if (!isPolicyAllowed('allow_product_feedback')) {
      return false;
    }

    // Probability gate from GrowthBook config (separate per rating)
    const probability = selected_0 === 'bad' ? badTranscriptAskConfig.probability : goodTranscriptAskConfig.probability;
    return Math.random() <= probability;
  }, [badTranscriptAskConfig.probability, goodTranscriptAskConfig.probability]);
  const onTranscriptPromptShown = useCallback((appearanceId_1: string, surveyResponse: FeedbackSurveyResponse) => {
    const trigger: TranscriptShareTrigger = surveyResponse === 'good' ? 'good_feedback_survey' : 'bad_feedback_survey';
    logEvent('tengu_feedback_survey_event', {
      event_type: 'transcript_prompt_appeared' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId_1 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      last_assistant_message_id: lastAssistantMessageIdRef.current as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      survey_type: surveyType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      trigger: trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    void logOTelEvent('feedback_survey', {
      event_type: 'transcript_prompt_appeared',
      appearance_id: appearanceId_1,
      survey_type: surveyType
    });
  }, [surveyType]);
  const onTranscriptSelect = useCallback(async (appearanceId_2: string, selected_1: TranscriptShareResponse, surveyResponse_0: FeedbackSurveyResponse | null): Promise<boolean> => {
    const trigger_0: TranscriptShareTrigger = surveyResponse_0 === 'good' ? 'good_feedback_survey' : 'bad_feedback_survey';
    logEvent('tengu_feedback_survey_event', {
      event_type: `transcript_share_${selected_1}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId_2 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      last_assistant_message_id: lastAssistantMessageIdRef.current as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      survey_type: surveyType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      trigger: trigger_0 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    if (selected_1 === 'dont_ask_again') {
      saveGlobalConfig(current_0 => ({
        ...current_0,
        transcriptShareDismissed: true
      }));
    }
    if (selected_1 === 'yes') {
      const result = await submitTranscriptShare(messagesRef.current, trigger_0, appearanceId_2);
      logEvent('tengu_feedback_survey_event', {
        event_type: (result.success ? 'transcript_share_submitted' : 'transcript_share_failed') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        appearance_id: appearanceId_2 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        trigger: trigger_0 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      return result.success;
    }
    return false;
  }, [surveyType]);
  const {
    state,
    lastResponse,
    open,
    handleSelect,
    handleTranscriptSelect
  } = useSurveyState({
    hideThanksAfterMs: config.hideThanksAfterMs,
    onOpen,
    onSelect,
    shouldShowTranscriptPrompt,
    onTranscriptPromptShown,
    onTranscriptSelect
  });
  const currentModel = getMainLoopModel();
  const isModelAllowed = useMemo(() => {
    if (config.onForModels.length === 0) {
      return false;
    }
    if (config.onForModels.includes('*')) {
      return true;
    }
    return config.onForModels.includes(currentModel);
  }, [config.onForModels, currentModel]);
  const shouldOpen = useMemo(() => {
    if (state !== 'closed') {
      return false;
    }
    if (isLoading) {
      return false;
    }

    // Don't show survey when permission or ask question prompts are visible
    if (hasActivePrompt) {
      return false;
    }

    // Force display for testing
    if (process.env.CLAUDE_FORCE_DISPLAY_SURVEY && !feedbackSurvey.timeLastShown) {
      return true;
    }
    if (!isModelAllowed) {
      return false;
    }
    if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY)) {
      return false;
    }
    if (isFeedbackSurveyDisabled()) {
      return false;
    }

    // Check if product feedback is allowed by org policy
    if (!isPolicyAllowed('allow_product_feedback')) {
      return false;
    }

    // Check session-local pacing
    if (feedbackSurvey.timeLastShown) {
      // Check time elapsed since last appearance in this session
      const timeSinceLastShown = Date.now() - feedbackSurvey.timeLastShown;
      if (timeSinceLastShown < config.minTimeBetweenFeedbackMs) {
        return false;
      }
      // Check user turn requirement for subsequent appearances
      if (feedbackSurvey.submitCountAtLastAppearance !== null && submitCount < feedbackSurvey.submitCountAtLastAppearance + config.minUserTurnsBetweenFeedback) {
        return false;
      }
    } else {
      // First appearance in this session
      const timeSinceSessionStart = Date.now() - sessionStartTime.current;
      if (timeSinceSessionStart < config.minTimeBeforeFeedbackMs) {
        return false;
      }
      if (submitCount < submitCountAtSessionStart.current + config.minUserTurnsBeforeFeedback) {
        return false;
      }
    }

    // Probability check: roll once per eligibility window to avoid re-rolling
    // on every useMemo re-evaluation (which would make triggering near-certain).
    if (lastEligibleSubmitCountRef.current !== submitCount) {
      lastEligibleSubmitCountRef.current = submitCount;
      probabilityPassedRef.current = Math.random() <= (settingsRate ?? config.probability);
    }
    if (!probabilityPassedRef.current) {
      return false;
    }

    // Check global pacing (across all sessions)
    // Leave this till last because it reads from the filesystem which is expensive.
    const globalFeedbackState = getGlobalConfig().feedbackSurveyState;
    if (globalFeedbackState?.lastShownTime) {
      const timeSinceGlobalLastShown = Date.now() - globalFeedbackState.lastShownTime;
      if (timeSinceGlobalLastShown < config.minTimeBetweenGlobalFeedbackMs) {
        return false;
      }
    }
    return true;
  }, [state, isLoading, hasActivePrompt, isModelAllowed, feedbackSurvey.timeLastShown, feedbackSurvey.submitCountAtLastAppearance, submitCount, config.minTimeBetweenFeedbackMs, config.minTimeBetweenGlobalFeedbackMs, config.minUserTurnsBetweenFeedback, config.minTimeBeforeFeedbackMs, config.minUserTurnsBeforeFeedback, config.probability, settingsRate]);
  useEffect(() => {
    if (shouldOpen) {
      open();
    }
  }, [shouldOpen, open]);
  return {
    state,
    lastResponse,
    handleSelect,
    handleTranscriptSelect
  };
}
