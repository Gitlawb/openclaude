import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { pathToFileURL } from 'url';
import Link from '../../ink/components/Link.js';
import { supportsHyperlinks } from '../../ink/supports-hyperlinks.js';
import { Box, Text } from '../../ink.js';
import { getStoredImagePath } from '../../utils/imageStore.js';
import { MessageResponse } from '../MessageResponse.js';
type Props = {
  imageId?: number;
  addMargin?: boolean;
};

/**
 * Renders an image attachment in user messages.
 * Shows as a clickable link if the image is stored and terminal supports hyperlinks.
 * Uses MessageResponse styling to appear connected to the message above,
 * unless addMargin is true (image starts a new user turn without text).
 */
export function UserImageMessage(t0) {
  const $ = _c(7);
  const {
    imageId,
    addMargin
  } = t0;
  const label = imageId ? `[Image #${imageId}]` : "[Image]";
  let t1;
  if ($[0] !== imageId || $[1] !== label) {
    const imagePath = imageId ? getStoredImagePath(imageId) : null;
    t1 = imagePath && supportsHyperlinks() ? <Link url={pathToFileURL(imagePath).href}><Text>{label}</Text></Link> : <Text>{label}</Text>;
    $[0] = imageId;
    $[1] = label;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const content = t1;
  if (addMargin) {
    let t2;
    if ($[3] !== content) {
      t2 = <Box marginTop={1}>{content}</Box>;
      $[3] = content;
      $[4] = t2;
    } else {
      t2 = $[4];
    }
    return t2;
  }
  let t2;
  if ($[5] !== content) {
    t2 = <MessageResponse>{content}</MessageResponse>;
    $[5] = content;
    $[6] = t2;
  } else {
    t2 = $[6];
  }
  return t2;
}
