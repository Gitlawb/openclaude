/**
 * Build-time globals replaced by the bundler at build time.
 *
 * `scripts/build.ts` substitutes these via Bun's `define` option, so at
 * runtime the references are inlined as string literals. This declaration
 * exists only to make `tsc --noEmit` aware of them — without it, every
 * `MACRO.*` access fires TS2304 "Cannot find name 'MACRO'".
 */
declare const MACRO: {
  VERSION: string
  DISPLAY_VERSION: string
  BUILD_TIME: string
  ISSUES_EXPLAINER: string
  PACKAGE_URL: string
  NATIVE_PACKAGE_URL: string | undefined
  FEEDBACK_CHANNEL: string
  VERSION_CHANGELOG: string
}
