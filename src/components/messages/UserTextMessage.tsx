import { c as _c } from "react-compiler-runtime";
import { feature } from '../../config/forgeFeatureFlags.js'
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { NO_CONTENT_MESSAGE } from '../../constants/messages.js';
import { COMMAND_MESSAGE_TAG, LOCAL_COMMAND_CAVEAT_TAG, TASK_NOTIFICATION_TAG, TEAMMATE_MESSAGE_TAG, TICK_TAG } from '../../constants/xml.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import { extractTag, INTERRUPT_MESSAGE, INTERRUPT_MESSAGE_FOR_TOOL_USE } from '../../utils/messages.js';
import { InterruptedByUser } from '../InterruptedByUser.js';
import { MessageResponse } from '../MessageResponse.js';
import { UserAgentNotificationMessage } from './UserAgentNotificationMessage.js';
import { UserBashInputMessage } from './UserBashInputMessage.js';
import { UserBashOutputMessage } from './UserBashOutputMessage.js';
import { UserCommandMessage } from './UserCommandMessage.js';
import { UserLocalCommandOutputMessage } from './UserLocalCommandOutputMessage.js';
import { UserMemoryInputMessage } from './UserMemoryInputMessage.js';
import { UserPlanMessage } from './UserPlanMessage.js';
import { UserPromptMessage } from './UserPromptMessage.js';
import { UserResourceUpdateMessage } from './UserResourceUpdateMessage.js';
import { UserTeammateMessage } from './UserTeammateMessage.js';
type Props = {
  addMargin: boolean;
  param: TextBlockParam;
  verbose: boolean;
  planContent?: string;
  isTranscriptMode?: boolean;
  timestamp?: string;
};
export function UserTextMessage(t0) {
  const $ = _c(49);
  const {
    addMargin,
    param,
    verbose,
    planContent,
    isTranscriptMode,
    timestamp
  } = t0;
  if (param.text.trim() === NO_CONTENT_MESSAGE) {
    return null;
  }
  if (planContent) {
    let t1;
    if ($[0] !== addMargin || $[1] !== planContent) {
      t1 = <UserPlanMessage addMargin={addMargin} planContent={planContent} />;
      $[0] = addMargin;
      $[1] = planContent;
      $[2] = t1;
    } else {
      t1 = $[2];
    }
    return t1;
  }
  if (extractTag(param.text, TICK_TAG)) {
    return null;
  }
  if (param.text.includes(`<${LOCAL_COMMAND_CAVEAT_TAG}>`)) {
    return null;
  }
  if (param.text.startsWith("<bash-stdout") || param.text.startsWith("<bash-stderr")) {
    let t1;
    if ($[3] !== param.text || $[4] !== verbose) {
      t1 = <UserBashOutputMessage content={param.text} verbose={verbose} />;
      $[3] = param.text;
      $[4] = verbose;
      $[5] = t1;
    } else {
      t1 = $[5];
    }
    return t1;
  }
  if (param.text.startsWith("<local-command-stdout") || param.text.startsWith("<local-command-stderr")) {
    let t1;
    if ($[6] !== param.text) {
      t1 = <UserLocalCommandOutputMessage content={param.text} />;
      $[6] = param.text;
      $[7] = t1;
    } else {
      t1 = $[7];
    }
    return t1;
  }
  if (param.text === INTERRUPT_MESSAGE || param.text === INTERRUPT_MESSAGE_FOR_TOOL_USE) {
    let t1;
    if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <MessageResponse height={1}><InterruptedByUser /></MessageResponse>;
      $[8] = t1;
    } else {
      t1 = $[8];
    }
    return t1;
  }
  if (feature("KAIROS_GITHUB_WEBHOOKS")) {
    if (param.text.startsWith("<github-webhook-activity>")) {
      let t1;
      if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
        t1 = require("./UserGitHubWebhookMessage.js");
        $[9] = t1;
      } else {
        t1 = $[9];
      }
      const {
        UserGitHubWebhookMessage
      } = t1 as typeof import('./UserGitHubWebhookMessage.js');
      let t2;
      if ($[10] !== addMargin || $[11] !== param) {
        t2 = <UserGitHubWebhookMessage addMargin={addMargin} param={param} />;
        $[10] = addMargin;
        $[11] = param;
        $[12] = t2;
      } else {
        t2 = $[12];
      }
      return t2;
    }
  }
  if (param.text.includes("<bash-input>")) {
    let t1;
    if ($[13] !== addMargin || $[14] !== param) {
      t1 = <UserBashInputMessage addMargin={addMargin} param={param} />;
      $[13] = addMargin;
      $[14] = param;
      $[15] = t1;
    } else {
      t1 = $[15];
    }
    return t1;
  }
  if (param.text.includes(`<${COMMAND_MESSAGE_TAG}>`)) {
    let t1;
    if ($[16] !== addMargin || $[17] !== param) {
      t1 = <UserCommandMessage addMargin={addMargin} param={param} />;
      $[16] = addMargin;
      $[17] = param;
      $[18] = t1;
    } else {
      t1 = $[18];
    }
    return t1;
  }
  if (param.text.includes("<user-memory-input>")) {
    let t1;
    if ($[19] !== addMargin || $[20] !== param.text) {
      t1 = <UserMemoryInputMessage addMargin={addMargin} text={param.text} />;
      $[19] = addMargin;
      $[20] = param.text;
      $[21] = t1;
    } else {
      t1 = $[21];
    }
    return t1;
  }
  if (isAgentSwarmsEnabled() && param.text.includes(`<${TEAMMATE_MESSAGE_TAG}`)) {
    let t1;
    if ($[22] !== addMargin || $[23] !== isTranscriptMode || $[24] !== param) {
      t1 = <UserTeammateMessage addMargin={addMargin} param={param} isTranscriptMode={isTranscriptMode} />;
      $[22] = addMargin;
      $[23] = isTranscriptMode;
      $[24] = param;
      $[25] = t1;
    } else {
      t1 = $[25];
    }
    return t1;
  }
  if (param.text.includes(`<${TASK_NOTIFICATION_TAG}`)) {
    let t1;
    if ($[26] !== addMargin || $[27] !== param) {
      t1 = <UserAgentNotificationMessage addMargin={addMargin} param={param} />;
      $[26] = addMargin;
      $[27] = param;
      $[28] = t1;
    } else {
      t1 = $[28];
    }
    return t1;
  }
  if (param.text.includes("<mcp-resource-update") || param.text.includes("<mcp-polling-update")) {
    let t1;
    if ($[29] !== addMargin || $[30] !== param) {
      t1 = <UserResourceUpdateMessage addMargin={addMargin} param={param} />;
      $[29] = addMargin;
      $[30] = param;
      $[31] = t1;
    } else {
      t1 = $[31];
    }
    return t1;
  }
  if (feature("FORK_SUBAGENT")) {
    if (param.text.includes("<fork-boilerplate>")) {
      let t1;
      if ($[32] === Symbol.for("react.memo_cache_sentinel")) {
        t1 = require("./UserForkBoilerplateMessage.js");
        $[32] = t1;
      } else {
        t1 = $[32];
      }
      const {
        UserForkBoilerplateMessage
      } = t1 as typeof import('./UserForkBoilerplateMessage.js');
      let t2;
      if ($[33] !== addMargin || $[34] !== param) {
        t2 = <UserForkBoilerplateMessage addMargin={addMargin} param={param} />;
        $[33] = addMargin;
        $[34] = param;
        $[35] = t2;
      } else {
        t2 = $[35];
      }
      return t2;
    }
  }
  if (feature("UDS_INBOX")) {
    if (param.text.includes("<cross-session-message")) {
      let t1;
      if ($[36] === Symbol.for("react.memo_cache_sentinel")) {
        t1 = require("./UserCrossSessionMessage.js");
        $[36] = t1;
      } else {
        t1 = $[36];
      }
      const {
        UserCrossSessionMessage
      } = t1 as typeof import('./UserCrossSessionMessage.js');
      let t2;
      if ($[37] !== addMargin || $[38] !== param) {
        t2 = <UserCrossSessionMessage addMargin={addMargin} param={param} />;
        $[37] = addMargin;
        $[38] = param;
        $[39] = t2;
      } else {
        t2 = $[39];
      }
      return t2;
    }
  }
  if (feature("KAIROS") || feature("KAIROS_CHANNELS")) {
    if (param.text.includes("<channel source=\"")) {
      let t1;
      if ($[40] === Symbol.for("react.memo_cache_sentinel")) {
        t1 = require("./UserChannelMessage.js");
        $[40] = t1;
      } else {
        t1 = $[40];
      }
      const {
        UserChannelMessage
      } = t1 as typeof import('./UserChannelMessage.js');
      let t2;
      if ($[41] !== addMargin || $[42] !== param) {
        t2 = <UserChannelMessage addMargin={addMargin} param={param} />;
        $[41] = addMargin;
        $[42] = param;
        $[43] = t2;
      } else {
        t2 = $[43];
      }
      return t2;
    }
  }
  let t1;
  if ($[44] !== addMargin || $[45] !== isTranscriptMode || $[46] !== param || $[47] !== timestamp) {
    t1 = <UserPromptMessage addMargin={addMargin} param={param} isTranscriptMode={isTranscriptMode} timestamp={timestamp} />;
    $[44] = addMargin;
    $[45] = isTranscriptMode;
    $[46] = param;
    $[47] = timestamp;
    $[48] = t1;
  } else {
    t1 = $[48];
  }
  return t1;
}
