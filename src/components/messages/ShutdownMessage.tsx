import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { isShutdownApproved, isShutdownRejected, isShutdownRequest, type ShutdownRejectedMessage, type ShutdownRequestMessage } from '../../utils/teammateMailbox.js';
type ShutdownRequestProps = {
  request: ShutdownRequestMessage;
};

/**
 * Renders a shutdown request with a warning-colored border.
 */
export function ShutdownRequestDisplay(t0) {
  const $ = _c(7);
  const {
    request
  } = t0;
  let t1;
  if ($[0] !== request.from) {
    t1 = <Box marginBottom={1}><Text color="warning" bold={true}>Shutdown request from {request.from}</Text></Box>;
    $[0] = request.from;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== request.reason) {
    t2 = request.reason && <Box><Text>Reason: {request.reason}</Text></Box>;
    $[2] = request.reason;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] !== t1 || $[5] !== t2) {
    t3 = <Box flexDirection="column" marginY={1}><Box borderStyle="round" borderColor="warning" flexDirection="column" paddingX={1} paddingY={1}>{t1}{t2}</Box></Box>;
    $[4] = t1;
    $[5] = t2;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  return t3;
}
type ShutdownRejectedProps = {
  response: ShutdownRejectedMessage;
};

/**
 * Renders a shutdown rejected message with a subtle (grey) border.
 */
export function ShutdownRejectedDisplay(t0) {
  const $ = _c(8);
  const {
    response
  } = t0;
  let t1;
  if ($[0] !== response.from) {
    t1 = <Text color="subtle" bold={true}>Shutdown rejected by {response.from}</Text>;
    $[0] = response.from;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== response.reason) {
    t2 = <Box marginTop={1} borderStyle="dashed" borderColor="subtle" borderLeft={false} borderRight={false} paddingX={1}><Text>Reason: {response.reason}</Text></Box>;
    $[2] = response.reason;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Box marginTop={1}><Text dimColor={true}>Teammate is continuing to work. You may request shutdown again later.</Text></Box>;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== t1 || $[6] !== t2) {
    t4 = <Box flexDirection="column" marginY={1}><Box borderStyle="round" borderColor="subtle" flexDirection="column" paddingX={1} paddingY={1}>{t1}{t2}{t3}</Box></Box>;
    $[5] = t1;
    $[6] = t2;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  return t4;
}

/**
 * Try to parse and render a shutdown message from raw content.
 * Returns the rendered component if it's a shutdown message, null otherwise.
 */
export function tryRenderShutdownMessage(content: string): React.ReactNode | null {
  const request = isShutdownRequest(content);
  if (request) {
    return <ShutdownRequestDisplay request={request} />;
  }

  // Shutdown approved is handled inline by the caller — skip it here
  if (isShutdownApproved(content)) {
    return null;
  }
  const rejected = isShutdownRejected(content);
  if (rejected) {
    return <ShutdownRejectedDisplay response={rejected} />;
  }
  return null;
}

/**
 * Get a brief summary text for a shutdown message.
 * Used in places like the inbox queue where we want a short description.
 * Returns null if the content is not a shutdown message.
 */
export function getShutdownMessageSummary(content: string): string | null {
  const request = isShutdownRequest(content);
  if (request) {
    return `[Shutdown Request from ${request.from}]${request.reason ? ` ${request.reason}` : ''}`;
  }
  const approved = isShutdownApproved(content);
  if (approved) {
    return `[Shutdown Approved] ${approved.from} is now exiting`;
  }
  const rejected = isShutdownRejected(content);
  if (rejected) {
    return `[Shutdown Rejected] ${rejected.from}: ${rejected.reason}`;
  }
  return null;
}
