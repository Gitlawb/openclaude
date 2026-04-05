import { c as _c } from "react-compiler-runtime";
import type { ReactNode } from 'react';
import React from 'react';
import type { Color, Styles, TextStyles } from '../styles.js';
type BaseProps = {
  /**
   * Change text color. Accepts a raw color value (rgb, hex, ansi).
   */
  readonly color?: Color;

  /**
   * Same as `color`, but for background.
   */
  readonly backgroundColor?: Color;

  /**
   * Make the text italic.
   */
  readonly italic?: boolean;

  /**
   * Make the text underlined.
   */
  readonly underline?: boolean;

  /**
   * Make the text crossed with a line.
   */
  readonly strikethrough?: boolean;

  /**
   * Inverse background and foreground colors.
   */
  readonly inverse?: boolean;

  /**
   * This property tells Ink to wrap or truncate text if its width is larger than container.
   * If `wrap` is passed (by default), Ink will wrap text and split it into multiple lines.
   * If `truncate-*` is passed, Ink will truncate text instead, which will result in one line of text with the rest cut off.
   */
  readonly wrap?: Styles['textWrap'];
  readonly children?: ReactNode;
};

/**
 * Bold and dim are mutually exclusive in terminals.
 * This type ensures you can use one or the other, but not both.
 */
type WeightProps = {
  bold?: never;
  dim?: never;
} | {
  bold: boolean;
  dim?: never;
} | {
  dim: boolean;
  bold?: never;
};
export type Props = BaseProps & WeightProps;
const memoizedStylesForWrap: Record<NonNullable<Styles['textWrap']>, Styles> = {
  wrap: {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'wrap'
  },
  'wrap-trim': {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'wrap-trim'
  },
  end: {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'end'
  },
  middle: {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'middle'
  },
  'truncate-end': {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'truncate-end'
  },
  truncate: {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'truncate'
  },
  'truncate-middle': {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'truncate-middle'
  },
  'truncate-start': {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap: 'truncate-start'
  }
} as const;

/**
 * This component can display text, and change its style to make it colorful, bold, underline, italic or strikethrough.
 */
export default function Text(t0) {
  const $ = _c(29);
  const {
    color,
    backgroundColor,
    bold,
    dim,
    italic: t1,
    underline: t2,
    strikethrough: t3,
    inverse: t4,
    wrap: t5,
    children
  } = t0;
  const italic = t1 === undefined ? false : t1;
  const underline = t2 === undefined ? false : t2;
  const strikethrough = t3 === undefined ? false : t3;
  const inverse = t4 === undefined ? false : t4;
  const wrap = t5 === undefined ? "wrap" : t5;
  if (children === undefined || children === null) {
    return null;
  }
  let t6;
  if ($[0] !== color) {
    t6 = color && {
      color
    };
    $[0] = color;
    $[1] = t6;
  } else {
    t6 = $[1];
  }
  let t7;
  if ($[2] !== backgroundColor) {
    t7 = backgroundColor && {
      backgroundColor
    };
    $[2] = backgroundColor;
    $[3] = t7;
  } else {
    t7 = $[3];
  }
  let t8;
  if ($[4] !== dim) {
    t8 = dim && {
      dim
    };
    $[4] = dim;
    $[5] = t8;
  } else {
    t8 = $[5];
  }
  let t9;
  if ($[6] !== bold) {
    t9 = bold && {
      bold
    };
    $[6] = bold;
    $[7] = t9;
  } else {
    t9 = $[7];
  }
  let t10;
  if ($[8] !== italic) {
    t10 = italic && {
      italic
    };
    $[8] = italic;
    $[9] = t10;
  } else {
    t10 = $[9];
  }
  let t11;
  if ($[10] !== underline) {
    t11 = underline && {
      underline
    };
    $[10] = underline;
    $[11] = t11;
  } else {
    t11 = $[11];
  }
  let t12;
  if ($[12] !== strikethrough) {
    t12 = strikethrough && {
      strikethrough
    };
    $[12] = strikethrough;
    $[13] = t12;
  } else {
    t12 = $[13];
  }
  let t13;
  if ($[14] !== inverse) {
    t13 = inverse && {
      inverse
    };
    $[14] = inverse;
    $[15] = t13;
  } else {
    t13 = $[15];
  }
  let t14;
  if ($[16] !== t10 || $[17] !== t11 || $[18] !== t12 || $[19] !== t13 || $[20] !== t6 || $[21] !== t7 || $[22] !== t8 || $[23] !== t9) {
    t14 = {
      ...t6,
      ...t7,
      ...t8,
      ...t9,
      ...t10,
      ...t11,
      ...t12,
      ...t13
    };
    $[16] = t10;
    $[17] = t11;
    $[18] = t12;
    $[19] = t13;
    $[20] = t6;
    $[21] = t7;
    $[22] = t8;
    $[23] = t9;
    $[24] = t14;
  } else {
    t14 = $[24];
  }
  const textStyles = t14;
  const t15 = memoizedStylesForWrap[wrap];
  let t16;
  if ($[25] !== children || $[26] !== t15 || $[27] !== textStyles) {
    t16 = <ink-text style={t15} textStyles={textStyles}>{children}</ink-text>;
    $[25] = children;
    $[26] = t15;
    $[27] = textStyles;
    $[28] = t16;
  } else {
    t16 = $[28];
  }
  return t16;
}
