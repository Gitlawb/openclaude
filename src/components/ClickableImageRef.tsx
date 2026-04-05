import { c as _c } from "react-compiler-runtime";
import { pathToFileURL } from 'url';
import Link from '../ink/components/Link.js';
import { supportsHyperlinks } from '../ink/supports-hyperlinks.js';
import { Text } from '../ink.js';
import { getStoredImagePath } from '../utils/imageStore.js';
import type { Theme } from '../utils/theme.js';
type Props = {
  imageId: number;
  backgroundColor?: keyof Theme;
  isSelected?: boolean;
};

/**
 * Renders an image reference like [Image #1] as a clickable link.
 * When clicked, opens the stored image file in the default viewer.
 *
 * Falls back to styled text if:
 * - Terminal doesn't support hyperlinks
 * - Image file is not found in the store
 */
export function ClickableImageRef(t0: Props) {
  const $ = _c(13);
  const {
    imageId,
    backgroundColor,
    isSelected: t1
  } = t0;
  const isSelected = t1 === undefined ? false : t1;
  const imagePath = getStoredImagePath(imageId);
  const displayText = `[Image #${imageId}]`;
  if (imagePath && supportsHyperlinks()) {
    const fileUrl = pathToFileURL(imagePath).href;
    let t2;
    let t3;
    if ($[0] !== backgroundColor || $[1] !== displayText || $[2] !== isSelected) {
      t2 = <Text backgroundColor={backgroundColor} inverse={isSelected}>{displayText}</Text>;
      t3 = <Text backgroundColor={backgroundColor} inverse={isSelected} bold={isSelected}>{displayText}</Text>;
      $[0] = backgroundColor;
      $[1] = displayText;
      $[2] = isSelected;
      $[3] = t2;
      $[4] = t3;
    } else {
      t2 = $[3];
      t3 = $[4];
    }
    let t4;
    if ($[5] !== fileUrl || $[6] !== t2 || $[7] !== t3) {
      t4 = <Link url={fileUrl} fallback={t2}>{t3}</Link>;
      $[5] = fileUrl;
      $[6] = t2;
      $[7] = t3;
      $[8] = t4;
    } else {
      t4 = $[8];
    }
    return t4;
  }
  let t2;
  if ($[9] !== backgroundColor || $[10] !== displayText || $[11] !== isSelected) {
    t2 = <Text backgroundColor={backgroundColor} inverse={isSelected}>{displayText}</Text>;
    $[9] = backgroundColor;
    $[10] = displayText;
    $[11] = isSelected;
    $[12] = t2;
  } else {
    t2 = $[12];
  }
  return t2;
}
