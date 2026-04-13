import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { Box } from '../../ink.js';
import { Divider } from '../design-system/Divider.js';
import type { FeedConfig } from './Feed.js';
import { calculateFeedWidth, Feed } from './Feed.js';
type FeedColumnProps = {
  feeds: FeedConfig[];
  maxWidth: number;
};
export function FeedColumn(t0) {
  const $ = _c(10);
  const {
    feeds,
    maxWidth
  } = t0;
  let t1;
  if ($[0] !== feeds) {
    const feedWidths = feeds.map(_temp);
    t1 = Math.max(...feedWidths);
    $[0] = feeds;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const maxOfAllFeeds = t1;
  const actualWidth = Math.min(maxOfAllFeeds, maxWidth);
  let t2;
  if ($[2] !== actualWidth || $[3] !== feeds) {
    let t3;
    if ($[5] !== actualWidth || $[6] !== feeds.length) {
      t3 = (feed_0, index) => <React.Fragment key={index}><Feed config={feed_0} actualWidth={actualWidth} />{index < feeds.length - 1 && <Divider color="claude" width={actualWidth} />}</React.Fragment>;
      $[5] = actualWidth;
      $[6] = feeds.length;
      $[7] = t3;
    } else {
      t3 = $[7];
    }
    t2 = feeds.map(t3);
    $[2] = actualWidth;
    $[3] = feeds;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[8] !== t2) {
    t3 = <Box flexDirection="column">{t2}</Box>;
    $[8] = t2;
    $[9] = t3;
  } else {
    t3 = $[9];
  }
  return t3;
}
function _temp(feed) {
  return calculateFeedWidth(feed);
}
