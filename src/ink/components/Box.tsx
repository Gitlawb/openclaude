import { c as _c } from "react-compiler-runtime";
import '../global.d.ts';
import React, { type PropsWithChildren } from 'react';
import type { Except } from 'type-fest';
import type { DOMElement } from '../dom.js';
import type { ClickEvent } from '../events/click-event.js';
import type { FocusEvent } from '../events/focus-event.js';
import type { KeyboardEvent } from '../events/keyboard-event.js';
import type { Styles } from '../styles.js';
import * as warn from '../warn.js';

const handlerIdentityKeys = new WeakMap<Function, number>();
let nextHandlerIdentityKey = 1;

function getHandlerIdentityKey(handler: Function): number {
  const existing = handlerIdentityKeys.get(handler);
  if (existing !== undefined) {
    return existing;
  }
  const next = nextHandlerIdentityKey++;
  handlerIdentityKeys.set(handler, next);
  return next;
}
export type Props = Except<Styles, 'textWrap'> & {
  /**
   * Tab order index. Nodes with `tabIndex >= 0` participate in
   * Tab/Shift+Tab cycling; `-1` means programmatically focusable only.
   */
  tabIndex?: number;
  /**
   * Focus this element when it mounts. Like the HTML `autofocus`
   * attribute — the FocusManager calls `focus(node)` during the
   * reconciler's `commitMount` phase.
   */
  autoFocus?: boolean;
  /**
   * Fired on left-button click (press + release without drag). Only works
   * inside `<AlternateScreen>` where mouse tracking is enabled — no-op
   * otherwise. The event bubbles from the deepest hit Box up through
   * ancestors; call `event.stopImmediatePropagation()` to stop bubbling.
   */
  onClick?: (event: ClickEvent) => void;
  onFocus?: (event: FocusEvent) => void;
  onFocusCapture?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  onBlurCapture?: (event: FocusEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onKeyDownCapture?: (event: KeyboardEvent) => void;
  /**
   * Fired when the mouse moves into this Box's rendered rect. Like DOM
   * `mouseenter`, does NOT bubble — moving between children does not
   * re-fire on the parent. Only works inside `<AlternateScreen>` where
   * mode-1003 mouse tracking is enabled.
   */
  onMouseEnter?: () => void;
  /** Fired when the mouse moves out of this Box's rendered rect. */
  onMouseLeave?: () => void;
};

/**
 * `<Box>` is an essential Ink component to build your layout. It's like `<div style="display: flex">` in the browser.
 */
function BoxInner(t0, ref: React.ForwardedRef<DOMElement>) {
  const $ = _c(43);
  let autoFocus;
  let children;
  let flexDirection;
  let flexGrow;
  let flexShrink;
  let flexWrap;
  let onBlur;
  let onBlurCapture;
  let onClick;
  let onFocus;
  let onFocusCapture;
  let onKeyDown;
  let onKeyDownCapture;
  let onMouseEnter;
  let onMouseLeave;
  let style;
  let tabIndex;
  if ($[0] !== t0) {
    const {
      children: t1,
      flexWrap: t2,
      flexDirection: t3,
      flexGrow: t4,
      flexShrink: t5,
      tabIndex: t6,
      autoFocus: t7,
      onClick: t8,
      onFocus: t9,
      onFocusCapture: t10,
      onBlur: t11,
      onBlurCapture: t12,
      onMouseEnter: t13,
      onMouseLeave: t14,
      onKeyDown: t15,
      onKeyDownCapture: t16,
      ...t17
    } = t0;
    children = t1;
    tabIndex = t6;
    autoFocus = t7;
    onClick = t8;
    onFocus = t9;
    onFocusCapture = t10;
    onBlur = t11;
    onBlurCapture = t12;
    onMouseEnter = t13;
    onMouseLeave = t14;
    onKeyDown = t15;
    onKeyDownCapture = t16;
    style = t17;
    flexWrap = t2 === undefined ? "nowrap" : t2;
    flexDirection = t3 === undefined ? "row" : t3;
    flexGrow = t4 === undefined ? 0 : t4;
    flexShrink = t5 === undefined ? 1 : t5;
    warn.ifNotInteger(style.margin, "margin");
    warn.ifNotInteger(style.marginX, "marginX");
    warn.ifNotInteger(style.marginY, "marginY");
    warn.ifNotInteger(style.marginTop, "marginTop");
    warn.ifNotInteger(style.marginBottom, "marginBottom");
    warn.ifNotInteger(style.marginLeft, "marginLeft");
    warn.ifNotInteger(style.marginRight, "marginRight");
    warn.ifNotInteger(style.padding, "padding");
    warn.ifNotInteger(style.paddingX, "paddingX");
    warn.ifNotInteger(style.paddingY, "paddingY");
    warn.ifNotInteger(style.paddingTop, "paddingTop");
    warn.ifNotInteger(style.paddingBottom, "paddingBottom");
    warn.ifNotInteger(style.paddingLeft, "paddingLeft");
    warn.ifNotInteger(style.paddingRight, "paddingRight");
    warn.ifNotInteger(style.gap, "gap");
    warn.ifNotInteger(style.columnGap, "columnGap");
    warn.ifNotInteger(style.rowGap, "rowGap");
    $[0] = t0;
    $[1] = autoFocus;
    $[2] = children;
    $[3] = flexDirection;
    $[4] = flexGrow;
    $[5] = flexShrink;
    $[6] = flexWrap;
    $[7] = onBlur;
    $[8] = onBlurCapture;
    $[9] = onClick;
    $[10] = onFocus;
    $[11] = onFocusCapture;
    $[12] = onKeyDown;
    $[13] = onKeyDownCapture;
    $[14] = onMouseEnter;
    $[15] = onMouseLeave;
    $[16] = style;
    $[17] = tabIndex;
  } else {
    autoFocus = $[1];
    children = $[2];
    flexDirection = $[3];
    flexGrow = $[4];
    flexShrink = $[5];
    flexWrap = $[6];
    onBlur = $[7];
    onBlurCapture = $[8];
    onClick = $[9];
    onFocus = $[10];
    onFocusCapture = $[11];
    onKeyDown = $[12];
    onKeyDownCapture = $[13];
    onMouseEnter = $[14];
    onMouseLeave = $[15];
    style = $[16];
    tabIndex = $[17];
  }
  const t1 = style.overflowX ?? style.overflow ?? "visible";
  const t2 = style.overflowY ?? style.overflow ?? "visible";
  const shouldRemountInteractiveHost = autoFocus === true && typeof tabIndex === 'number' && tabIndex >= 0 && onKeyDown !== undefined;
  const hostKey = shouldRemountInteractiveHost ? getHandlerIdentityKey(onKeyDown) : undefined;
  let t3;
  if ($[19] !== flexDirection || $[20] !== flexGrow || $[21] !== flexShrink || $[22] !== flexWrap || $[23] !== style || $[24] !== t1 || $[25] !== t2) {
    t3 = {
      flexWrap,
      flexDirection,
      flexGrow,
      flexShrink,
      ...style,
      overflowX: t1,
      overflowY: t2
    };
    $[19] = flexDirection;
    $[20] = flexGrow;
    $[21] = flexShrink;
    $[22] = flexWrap;
    $[23] = style;
    $[24] = t1;
    $[25] = t2;
    $[26] = t3;
  } else {
    t3 = $[26];
  }
  let t4;
  if ($[27] !== autoFocus || $[28] !== children || $[29] !== hostKey || $[30] !== onBlur || $[31] !== onBlurCapture || $[32] !== onClick || $[33] !== onFocus || $[34] !== onFocusCapture || $[35] !== onKeyDown || $[36] !== onKeyDownCapture || $[37] !== onMouseEnter || $[38] !== onMouseLeave || $[39] !== ref || $[40] !== t3 || $[41] !== tabIndex) {
    t4 = <ink-box key={hostKey} ref={ref} tabIndex={tabIndex} autoFocus={autoFocus} onClick={onClick} onFocus={onFocus} onFocusCapture={onFocusCapture} onBlur={onBlur} onBlurCapture={onBlurCapture} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onKeyDown={onKeyDown} onKeyDownCapture={onKeyDownCapture} style={t3}>{children}</ink-box>;
    $[27] = autoFocus;
    $[28] = children;
    $[29] = hostKey;
    $[30] = onBlur;
    $[31] = onBlurCapture;
    $[32] = onClick;
    $[33] = onFocus;
    $[34] = onFocusCapture;
    $[35] = onKeyDown;
    $[36] = onKeyDownCapture;
    $[37] = onMouseEnter;
    $[38] = onMouseLeave;
    $[39] = ref;
    $[40] = t3;
    $[41] = tabIndex;
    $[42] = t4;
  } else {
    t4 = $[42];
  }
  return t4;
}
const Box = React.forwardRef<DOMElement, PropsWithChildren<Props>>(BoxInner);
Box.displayName = 'Box';
export default Box;
