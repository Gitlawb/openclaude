import { c as _c } from "react-compiler-runtime";
import chalk from 'chalk';
import type { UUID } from 'crypto';
import * as React from 'react';
import { getSessionId } from '../../bootstrap/state.js';
import type { CommandResultDisplay } from '../../commands.js';
import { Select } from '../../components/CustomSelect/select.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js';
import { Box, Text } from '../../ink.js';
import { logEvent } from '../../services/analytics/index.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { recursivelySanitizeUnicode } from '../../utils/sanitization.js';
import { getCurrentSessionTag, getTranscriptPath, saveTag } from '../../utils/sessionStorage.js';
function ConfirmRemoveTag(t0) {
  const $ = _c(11);
  const {
    tagName,
    onConfirm,
    onCancel
  } = t0;
  const t1 = `Current tag: #${tagName}`;
  let t2;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Text>This will remove the tag from the current session.</Text>;
    $[0] = t2;
  } else {
    t2 = $[0];
  }
  let t3;
  if ($[1] !== onCancel || $[2] !== onConfirm) {
    t3 = value => value === "yes" ? onConfirm() : onCancel();
    $[1] = onCancel;
    $[2] = onConfirm;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  let t4;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = [{
      label: "Yes, remove tag",
      value: "yes"
    }, {
      label: "No, keep tag",
      value: "no"
    }];
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let t5;
  if ($[5] !== t3) {
    t5 = <Box flexDirection="column" gap={1}>{t2}<Select onChange={t3} options={t4} /></Box>;
    $[5] = t3;
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  let t6;
  if ($[7] !== onCancel || $[8] !== t1 || $[9] !== t5) {
    t6 = <Dialog title="Remove tag?" subtitle={t1} onCancel={onCancel} color="warning">{t5}</Dialog>;
    $[7] = onCancel;
    $[8] = t1;
    $[9] = t5;
    $[10] = t6;
  } else {
    t6 = $[10];
  }
  return t6;
}
function ToggleTagAndClose(t0) {
  const $ = _c(17);
  const {
    tagName,
    onDone
  } = t0;
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [sessionId, setSessionId] = React.useState(null);
  let t1;
  if ($[0] !== tagName) {
    t1 = recursivelySanitizeUnicode(tagName).trim();
    $[0] = tagName;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const normalizedTag = t1;
  let t2;
  let t3;
  if ($[2] !== normalizedTag || $[3] !== onDone) {
    t2 = () => {
      const id = getSessionId() as UUID;
      if (!id) {
        onDone("No active session to tag", {
          display: "system"
        });
        return;
      }
      if (!normalizedTag) {
        onDone("Tag name cannot be empty", {
          display: "system"
        });
        return;
      }
      setSessionId(id);
      const currentTag = getCurrentSessionTag(id);
      if (currentTag === normalizedTag) {
        logEvent("tengu_tag_command_remove_prompt", {});
        setShowConfirm(true);
      } else {
        const isReplacing = !!currentTag;
        logEvent("tengu_tag_command_add", {
          is_replacing: isReplacing
        });
        (async () => {
          const fullPath = getTranscriptPath();
          await saveTag(id, normalizedTag, fullPath);
          onDone(`Tagged session with ${chalk.cyan(`#${normalizedTag}`)}`, {
            display: "system"
          });
        })();
      }
    };
    t3 = [normalizedTag, onDone];
    $[2] = normalizedTag;
    $[3] = onDone;
    $[4] = t2;
    $[5] = t3;
  } else {
    t2 = $[4];
    t3 = $[5];
  }
  React.useEffect(t2, t3);
  if (showConfirm && sessionId) {
    let t4;
    if ($[6] !== normalizedTag || $[7] !== onDone || $[8] !== sessionId) {
      t4 = async () => {
        logEvent("tengu_tag_command_remove_confirmed", {});
        const fullPath_0 = getTranscriptPath();
        await saveTag(sessionId, "", fullPath_0);
        onDone(`Removed tag ${chalk.cyan(`#${normalizedTag}`)}`, {
          display: "system"
        });
      };
      $[6] = normalizedTag;
      $[7] = onDone;
      $[8] = sessionId;
      $[9] = t4;
    } else {
      t4 = $[9];
    }
    let t5;
    if ($[10] !== normalizedTag || $[11] !== onDone) {
      t5 = () => {
        logEvent("tengu_tag_command_remove_cancelled", {});
        onDone(`Kept tag ${chalk.cyan(`#${normalizedTag}`)}`, {
          display: "system"
        });
      };
      $[10] = normalizedTag;
      $[11] = onDone;
      $[12] = t5;
    } else {
      t5 = $[12];
    }
    let t6;
    if ($[13] !== normalizedTag || $[14] !== t4 || $[15] !== t5) {
      t6 = <ConfirmRemoveTag tagName={normalizedTag} onConfirm={t4} onCancel={t5} />;
      $[13] = normalizedTag;
      $[14] = t4;
      $[15] = t5;
      $[16] = t6;
    } else {
      t6 = $[16];
    }
    return t6;
  }
  return null;
}
function ShowHelp(t0) {
  const $ = _c(3);
  const {
    onDone
  } = t0;
  let t1;
  let t2;
  if ($[0] !== onDone) {
    t1 = () => {
      onDone("Usage: /tag <tag-name>\n\nToggle a searchable tag on the current session.\nRun the same command again to remove the tag.\nTags are displayed after the branch name in /resume and can be searched with /.\n\nExamples:\n  /tag bugfix        # Add tag\n  /tag bugfix        # Remove tag (toggle)\n  /tag feature-auth\n  /tag wip", {
        display: "system"
      });
    };
    t2 = [onDone];
    $[0] = onDone;
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  React.useEffect(t1, t2);
  return null;
}
export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  args = args?.trim() || '';
  if (COMMON_INFO_ARGS.includes(args) || COMMON_HELP_ARGS.includes(args)) {
    return <ShowHelp onDone={onDone} />;
  }
  if (!args) {
    return <ShowHelp onDone={onDone} />;
  }
  return <ToggleTagAndClose tagName={args} onDone={onDone} />;
}
