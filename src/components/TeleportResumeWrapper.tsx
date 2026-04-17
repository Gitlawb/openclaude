import { c as _c } from "react-compiler-runtime";
import React, { useEffect } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import type { TeleportRemoteResponse } from 'src/utils/conversationRecovery.js';
import type { CodeSession } from 'src/utils/teleport/api.js';
import { type TeleportSource, useTeleportResume } from '../hooks/useTeleportResume.js';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { ResumeTask } from './ResumeTask.js';
import { Spinner } from './Spinner.js';
interface TeleportResumeWrapperProps {
  onComplete: (result: TeleportRemoteResponse) => void;
  onCancel: () => void;
  onError?: (error: string, formattedMessage?: string) => void;
  isEmbedded?: boolean;
  source: TeleportSource;
}

/**
 * Wrapper component that manages the full teleport resume flow,
 * including session selection, loading state, and error handling
 */
export function TeleportResumeWrapper(t0) {
  const $ = _c(25);
  const {
    onComplete,
    onCancel,
    onError,
    isEmbedded: t1,
    source
  } = t0;
  const isEmbedded = t1 === undefined ? false : t1;
  const {
    resumeSession,
    isResuming,
    error,
    selectedSession
  } = useTeleportResume(source);
  let t2;
  let t3;
  if ($[0] !== source) {
    t2 = () => {
      logEvent("tengu_teleport_started", {
        source: source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    };
    t3 = [source];
    $[0] = source;
    $[1] = t2;
    $[2] = t3;
  } else {
    t2 = $[1];
    t3 = $[2];
  }
  useEffect(t2, t3);
  let t4;
  if ($[3] !== error || $[4] !== onComplete || $[5] !== onError || $[6] !== resumeSession) {
    t4 = async session => {
      const result = await resumeSession(session);
      if (result) {
        onComplete(result);
      } else {
        if (error) {
          if (onError) {
            onError(error.message, error.formattedMessage);
          }
        }
      }
    };
    $[3] = error;
    $[4] = onComplete;
    $[5] = onError;
    $[6] = resumeSession;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  const handleSelect = t4;
  let t5;
  if ($[8] !== onCancel) {
    t5 = () => {
      logEvent("tengu_teleport_cancelled", {});
      onCancel();
    };
    $[8] = onCancel;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  const handleCancel = t5;
  const t6 = !!error && !onError;
  let t7;
  if ($[10] !== t6) {
    t7 = {
      context: "Global",
      isActive: t6
    };
    $[10] = t6;
    $[11] = t7;
  } else {
    t7 = $[11];
  }
  useKeybinding("app:interrupt", handleCancel, t7);
  if (isResuming && selectedSession) {
    let t8;
    if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
      t8 = <Box flexDirection="row"><Spinner /><Text bold={true}>Відновлюємо сесію…</Text></Box>;
      $[12] = t8;
    } else {
      t8 = $[12];
    }
    let t9;
    if ($[13] !== selectedSession.title) {
      t9 = <Box flexDirection="column" padding={1}>{t8}<Text dimColor={true}>Завантаження "{selectedSession.title}"…</Text></Box>;
      $[13] = selectedSession.title;
      $[14] = t9;
    } else {
      t9 = $[14];
    }
    return t9;
  }
  if (error && !onError) {
    let t8;
    if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
      t8 = <Text bold={true} color="error">Не вдалося відновити сесію</Text>;
      $[15] = t8;
    } else {
      t8 = $[15];
    }
    let t9;
    if ($[16] !== error.message) {
      t9 = <Text dimColor={true}>{error.message}</Text>;
      $[16] = error.message;
      $[17] = t9;
    } else {
      t9 = $[17];
    }
    let t10;
    if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
      t10 = <Box marginTop={1}><Text dimColor={true}>Натисніть <Text bold={true}>Esc</Text> для скасування</Text></Box>;
      $[18] = t10;
    } else {
      t10 = $[18];
    }
    let t11;
    if ($[19] !== t9) {
      t11 = <Box flexDirection="column" padding={1}>{t8}{t9}{t10}</Box>;
      $[19] = t9;
      $[20] = t11;
    } else {
      t11 = $[20];
    }
    return t11;
  }
  let t8;
  if ($[21] !== handleCancel || $[22] !== handleSelect || $[23] !== isEmbedded) {
    t8 = <ResumeTask onSelect={handleSelect} onCancel={handleCancel} isEmbedded={isEmbedded} />;
    $[21] = handleCancel;
    $[22] = handleSelect;
    $[23] = isEmbedded;
    $[24] = t8;
  } else {
    t8 = $[24];
  }
  return t8;
}
