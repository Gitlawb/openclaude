import { c as _c } from "react-compiler-runtime";
import chalk from 'chalk';
import figures from 'figures';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { toError } from '../utils/errors.js';
import { logError } from '../utils/log.js';
import { getSettingSourceName, type SettingSource } from '../utils/settings/constants.js';
import { updateSettingsForSource } from '../utils/settings/settings.js';
import { getEnvironmentSelectionInfo } from '../utils/teleport/environmentSelection.js';
import type { EnvironmentResource } from '../utils/teleport/environments.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/select.js';
import { Byline } from './design-system/Byline.js';
import { Dialog } from './design-system/Dialog.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { LoadingState } from './design-system/LoadingState.js';
const DIALOG_TITLE = 'Оберіть віддалене середовище';
const SETUP_HINT = `Налаштуйте середовища на: https://claude.ai/code`;
type Props = {
  onDone: (message?: string) => void;
};
type LoadingState = 'loading' | 'updating' | null;
export function RemoteEnvironmentDialog(t0) {
  const $ = _c(27);
  const {
    onDone
  } = t0;
  const [loadingState, setLoadingState] = useState("loading");
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const [environments, setEnvironments] = useState(t1);
  const [selectedEnvironment, setSelectedEnvironment] = useState(null);
  const [selectedEnvironmentSource, setSelectedEnvironmentSource] = useState(null);
  const [error, setError] = useState(null);
  let t2;
  let t3;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = () => {
      let cancelled = false;
      const fetchInfo = async function fetchInfo() {
        ;
        try {
          const result = await getEnvironmentSelectionInfo();
          if (cancelled) {
            return;
          }
          setEnvironments(result.availableEnvironments);
          setSelectedEnvironment(result.selectedEnvironment);
          setSelectedEnvironmentSource(result.selectedEnvironmentSource);
          setLoadingState(null);
        } catch (t4) {
          const err = t4;
          if (cancelled) {
            return;
          }
          const fetchError = toError(err);
          logError(fetchError);
          setError(fetchError.message);
          setLoadingState(null);
        }
      };
      fetchInfo();
      return () => {
        cancelled = true;
      };
    };
    t3 = [];
    $[1] = t2;
    $[2] = t3;
  } else {
    t2 = $[1];
    t3 = $[2];
  }
  useEffect(t2, t3);
  let t4;
  if ($[3] !== environments || $[4] !== onDone) {
    t4 = function handleSelect(value) {
      if (value === "cancel") {
        onDone();
        return;
      }
      setLoadingState("updating");
      const selectedEnv = environments.find(env => env.environment_id === value);
      if (!selectedEnv) {
        onDone("Помилка: Обране середовище не знайдено");
        return;
      }
      updateSettingsForSource("localSettings", {
        remote: {
          defaultEnvironmentId: selectedEnv.environment_id
        }
      });
      onDone(`Типове віддалене середовище встановлено як ${chalk.bold(selectedEnv.name)} (${selectedEnv.environment_id})`);
    };
    $[3] = environments;
    $[4] = onDone;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  const handleSelect = t4;
  if (loadingState === "loading") {
    let t5;
    if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
      t5 = <LoadingState message={"Завантаження середовищ\u2026"} />;
      $[6] = t5;
    } else {
      t5 = $[6];
    }
    let t6;
    if ($[7] !== onDone) {
      t6 = <Dialog title={DIALOG_TITLE} onCancel={onDone} hideInputGuide={true}>{t5}</Dialog>;
      $[7] = onDone;
      $[8] = t6;
    } else {
      t6 = $[8];
    }
    return t6;
  }
  if (error) {
    let t5;
    if ($[9] !== error) {
      t5 = <Text color="error">Помилка: {error}</Text>;
      $[9] = error;
      $[10] = t5;
    } else {
      t5 = $[10];
    }
    let t6;
    if ($[11] !== onDone || $[12] !== t5) {
      t6 = <Dialog title={DIALOG_TITLE} onCancel={onDone}>{t5}</Dialog>;
      $[11] = onDone;
      $[12] = t5;
      $[13] = t6;
    } else {
      t6 = $[13];
    }
    return t6;
  }
  if (!selectedEnvironment) {
    let t5;
    if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
      t5 = <Text>Віддалені середовища недоступні.</Text>;
      $[14] = t5;
    } else {
      t5 = $[14];
    }
    let t6;
    if ($[15] !== onDone) {
      t6 = <Dialog title={DIALOG_TITLE} subtitle={SETUP_HINT} onCancel={onDone}>{t5}</Dialog>;
      $[15] = onDone;
      $[16] = t6;
    } else {
      t6 = $[16];
    }
    return t6;
  }
  if (environments.length === 1) {
    let t5;
    if ($[17] !== onDone || $[18] !== selectedEnvironment) {
      t5 = <SingleEnvironmentContent environment={selectedEnvironment} onDone={onDone} />;
      $[17] = onDone;
      $[18] = selectedEnvironment;
      $[19] = t5;
    } else {
      t5 = $[19];
    }
    return t5;
  }
  let t5;
  if ($[20] !== environments || $[21] !== handleSelect || $[22] !== loadingState || $[23] !== onDone || $[24] !== selectedEnvironment || $[25] !== selectedEnvironmentSource) {
    t5 = <MultipleEnvironmentsContent environments={environments} selectedEnvironment={selectedEnvironment} selectedEnvironmentSource={selectedEnvironmentSource} loadingState={loadingState} onSelect={handleSelect} onCancel={onDone} />;
    $[20] = environments;
    $[21] = handleSelect;
    $[22] = loadingState;
    $[23] = onDone;
    $[24] = selectedEnvironment;
    $[25] = selectedEnvironmentSource;
    $[26] = t5;
  } else {
    t5 = $[26];
  }
  return t5;
}
function EnvironmentLabel(t0) {
  const $ = _c(7);
  const {
    environment
  } = t0;
  let t1;
  if ($[0] !== environment.name) {
    t1 = <Text bold={true}>{environment.name}</Text>;
    $[0] = environment.name;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== environment.environment_id) {
    t2 = <Text dimColor={true}>({environment.environment_id})</Text>;
    $[2] = environment.environment_id;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] !== t1 || $[5] !== t2) {
    t3 = <Text>{figures.tick} Використовуємо {t1}{" "}{t2}</Text>;
    $[4] = t1;
    $[5] = t2;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  return t3;
}
function SingleEnvironmentContent(t0) {
  const $ = _c(6);
  const {
    environment,
    onDone
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = {
      context: "Confirmation"
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  useKeybinding("confirm:yes", onDone, t1);
  let t2;
  if ($[1] !== environment) {
    t2 = <EnvironmentLabel environment={environment} />;
    $[1] = environment;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== onDone || $[4] !== t2) {
    t3 = <Dialog title={DIALOG_TITLE} subtitle={SETUP_HINT} onCancel={onDone}>{t2}</Dialog>;
    $[3] = onDone;
    $[4] = t2;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  return t3;
}
function MultipleEnvironmentsContent(t0) {
  const $ = _c(18);
  const {
    environments,
    selectedEnvironment,
    selectedEnvironmentSource,
    loadingState,
    onSelect,
    onCancel
  } = t0;
  let t1;
  if ($[0] !== selectedEnvironmentSource) {
    t1 = selectedEnvironmentSource && selectedEnvironmentSource !== "localSettings" ? ` (з налаштувань ${getSettingSourceName(selectedEnvironmentSource)})` : "";
    $[0] = selectedEnvironmentSource;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const sourceSuffix = t1;
  let t2;
  if ($[2] !== selectedEnvironment.name) {
    t2 = <Text bold={true}>{selectedEnvironment.name}</Text>;
    $[2] = selectedEnvironment.name;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] !== sourceSuffix || $[5] !== t2) {
    t3 = <Text>Зараз використовується: {t2}{sourceSuffix}</Text>;
    $[4] = sourceSuffix;
    $[5] = t2;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const subtitle = t3;
  let t4;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Text dimColor={true}>{SETUP_HINT}</Text>;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== environments || $[9] !== loadingState || $[10] !== onSelect || $[11] !== selectedEnvironment.environment_id) {
    t5 = loadingState === "updating" ? <LoadingState message={"Оновлення\u2026"} /> : <Select options={environments.map(_temp)} defaultValue={selectedEnvironment.environment_id} onChange={onSelect} onCancel={() => onSelect("cancel")} layout="compact-vertical" />;
    $[8] = environments;
    $[9] = loadingState;
    $[10] = onSelect;
    $[11] = selectedEnvironment.environment_id;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  let t6;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Text dimColor={true}><Byline><KeyboardShortcutHint shortcut="Enter" action="обрати" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="скасувати" /></Byline></Text>;
    $[13] = t6;
  } else {
    t6 = $[13];
  }
  let t7;
  if ($[14] !== onCancel || $[15] !== subtitle || $[16] !== t5) {
    t7 = <Dialog title={DIALOG_TITLE} subtitle={subtitle} onCancel={onCancel} hideInputGuide={true}>{t4}{t5}{t6}</Dialog>;
    $[14] = onCancel;
    $[15] = subtitle;
    $[16] = t5;
    $[17] = t7;
  } else {
    t7 = $[17];
  }
  return t7;
}
function _temp(env) {
  return {
    label: <Text>{env.name} <Text dimColor={true}>({env.environment_id})</Text></Text>,
    value: env.environment_id
  };
}
