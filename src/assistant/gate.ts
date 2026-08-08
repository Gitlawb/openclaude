/**
 * Assistant mode (KAIROS) entitlement gate.
 *
 * The closed-source implementation checks a disk-cached GrowthBook gate
 * (tengu_kairos) with a lazy fresh fetch. This open-source build ships an
 * inert gate that always reports disabled.
 */

/** Whether assistant mode is entitled for this user. Always false. */
export async function isKairosEnabled(): Promise<boolean> {
  return false
}
