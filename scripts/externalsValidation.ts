/**
 * Pure validation helpers for the externals/bundling contract, factored out of
 * validate-externals.ts so the rules (bundle-specific bundled exemptions, the
 * minimal-install dependency placement contract) are unit-testable with
 * synthetic package.json / externals inputs.
 */

export type ValidationResult = { ok: boolean; errors: string[] }

export type PkgDeps = {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  devDependencies?: Record<string, string>
}

/**
 * The set of INTENTIONALLY_BUNDLED packages that are genuinely inlined into a
 * given bundle. A package declared as a peerDependency is provided by the
 * consumer, so it must be EXTERNAL in the SDK bundle and is therefore NOT
 * exempt there — pass `peerDepNames` (from package.json) for the SDK so the
 * exemption stays independent of the externals list it is meant to guard.
 */
export function bundledExemptionFor(
  intentionallyBundled: string[],
  externalizedHere: ReadonlySet<string>,
): Set<string> {
  return new Set(intentionallyBundled.filter(d => !externalizedHere.has(d)))
}

/**
 * Every runtime dependency (shipped `dependencies` + `peerDependencies`) must be
 * a genuine external for a bundle, unless it is intentionally bundled INTO that
 * bundle. Anything else would be missing at runtime for end users.
 */
export function validateBundleExternals(
  bundleName: string,
  runtimeDeps: ReadonlySet<string>,
  externals: string[],
  bundledExemption: ReadonlySet<string>,
): ValidationResult {
  const externalSet = new Set(externals)
  const missing = [...runtimeDeps].filter(
    d => !externalSet.has(d) && !bundledExemption.has(d),
  )
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [
        `${bundleName}: Dependencies missing from externals: ${missing.join(', ')}`,
      ],
    }
  }
  return { ok: true, errors: [] }
}

/**
 * The minimal-install contract for INTENTIONALLY_BUNDLED packages:
 *  - every entry must be a devDependency (available to build, not shipped),
 *  - none may be a runtime `dependency` (they are inlined; shipping them would
 *    install them for every user), and
 *  - only the SDK-externalized subset may be an (optional) peerDependency.
 */
export function validateIntentionallyBundled(
  pkg: PkgDeps,
  intentionallyBundled: string[],
  sdkOnlyExternals: string[],
): ValidationResult {
  const directDeps = pkg.dependencies ?? {}
  const peerDeps = pkg.peerDependencies ?? {}
  const devDeps = pkg.devDependencies ?? {}
  const sdkExternalOnly = new Set(sdkOnlyExternals)
  const errors: string[] = []

  const missingFromDev = intentionallyBundled.filter(dep => !(dep in devDeps))
  if (missingFromDev.length > 0) {
    errors.push(
      `INTENTIONALLY_BUNDLED entries missing from devDependencies: ${missingFromDev.join(', ')}`,
    )
  }

  const shippedAsRuntime = intentionallyBundled.filter(dep => dep in directDeps)
  if (shippedAsRuntime.length > 0) {
    errors.push(
      `INTENTIONALLY_BUNDLED entries must not be in dependencies (they are inlined): ${shippedAsRuntime.join(', ')}`,
    )
  }

  const unexpectedPeers = intentionallyBundled.filter(
    dep => dep in peerDeps && !sdkExternalOnly.has(dep),
  )
  if (unexpectedPeers.length > 0) {
    errors.push(
      `INTENTIONALLY_BUNDLED entries in peerDependencies that are not SDK externals: ${unexpectedPeers.join(', ')}`,
    )
  }

  // Every SDK-external must STAY a peerDependency: the SDK bundle externalizes
  // it, so consumers provide it. If one drops out of peerDependencies it leaves
  // runtimeDeps (and other checks stop seeing it) while the SDK still expects it
  // resolved at the consumer — a broken SDK publish surface.
  const missingPeers = sdkOnlyExternals.filter(dep => !(dep in peerDeps))
  if (missingPeers.length > 0) {
    errors.push(
      `SDK externals must remain peerDependencies (the SDK bundle externalizes them): ${missingPeers.join(', ')}`,
    )
  }

  return { ok: errors.length === 0, errors }
}

/**
 * The minimal-install goal depends on every peerDependency being OPTIONAL: a
 * non-optional peer makes npm warn (and, on npm 7+, try to install it) for every
 * end user. Assert each declared peer is marked `{ optional: true }` in
 * peerDependenciesMeta so losing that flag fails the build instead of silently
 * regressing the warning-free install.
 */
export function validateOptionalPeers(pkg: PkgDeps): ValidationResult {
  const peers = Object.keys(pkg.peerDependencies ?? {})
  const meta = pkg.peerDependenciesMeta ?? {}
  const notOptional = peers.filter(p => meta[p]?.optional !== true)
  if (notOptional.length > 0) {
    return {
      ok: false,
      errors: [
        `peerDependencies must be marked optional in peerDependenciesMeta (warning-free install): ${notOptional.join(', ')}`,
      ],
    }
  }
  return { ok: true, errors: [] }
}

/**
 * OPTIONAL_RUNTIME_EXTERNALS are never shipped and never inlined. Anything
 * esbuild can see statically must therefore stay external in BOTH bundles;
 * dropping one from the externals lists would let esbuild bundle it (a native
 * module like sharp) or hoist its transitive imports. The indirection-only
 * subset (loaded purely via the runtime importer) is the inverse: it must stay
 * OUT of the externals lists, or esbuild would re-introduce its static imports.
 *
 * Also guards both halves of the install contract: optional packages must never
 * be shipped (in dependencies/peerDependencies), and the non-transitive ones
 * must be devDependencies so source/dev builds still resolve them.
 */
export function validateOptionalRuntimeExternals(
  optionalRuntimeExternals: string[],
  cliExternals: string[],
  sdkExternals: string[],
  indirectionOnly: string[],
  pkg: PkgDeps = {},
  transitiveExternals: string[] = [],
): ValidationResult {
  const cli = new Set(cliExternals)
  const sdk = new Set(sdkExternals)
  const indirection = new Set(indirectionOnly)
  const transitive = new Set(transitiveExternals)
  const directDeps = pkg.dependencies ?? {}
  const peerDeps = pkg.peerDependencies ?? {}
  const devDeps = pkg.devDependencies ?? {}
  const errors: string[] = []

  // The indirection-only set must be a subset of the optional externals (a
  // stray entry would silently exempt something that is not actually optional).
  const strayIndirection = indirectionOnly.filter(
    p => !optionalRuntimeExternals.includes(p),
  )
  if (strayIndirection.length > 0) {
    errors.push(
      `RUNTIME_INDIRECTION_ONLY_EXTERNALS entries not in OPTIONAL_RUNTIME_EXTERNALS: ${strayIndirection.join(', ')}`,
    )
  }

  // Optional runtime externals are loaded on demand and must NEVER be shipped by
  // default — listing one in dependencies or peerDependencies installs it for
  // every user and breaks the minimal/warning-free install contract.
  const shipped = optionalRuntimeExternals.filter(
    dep => dep in directDeps || dep in peerDeps,
  )
  if (shipped.length > 0) {
    errors.push(
      `OPTIONAL_RUNTIME_EXTERNALS must not be shipped (found in dependencies/peerDependencies): ${shipped.join(', ')}`,
    )
  }

  // Source-install contract: optional packages that source code references
  // directly must be devDependencies so `bun install` source/dev builds resolve
  // them. The transitive set is exempt (provided by another optional package's
  // dependency tree, e.g. @aws-sdk/* via @anthropic-ai/bedrock-sdk).
  const missingFromDev = optionalRuntimeExternals.filter(
    dep => !transitive.has(dep) && !(dep in devDeps),
  )
  if (missingFromDev.length > 0) {
    errors.push(
      `OPTIONAL_RUNTIME_EXTERNALS missing from devDependencies (source builds need them): ${missingFromDev.join(', ')}`,
    )
  }

  for (const dep of optionalRuntimeExternals) {
    if (indirection.has(dep)) {
      // Must NOT be external (would re-expose its static imports to esbuild).
      if (cli.has(dep) || sdk.has(dep)) {
        errors.push(
          `${dep} is runtime-indirection-only and must NOT be in CLI/SDK externals.`,
        )
      }
      continue
    }
    // Must stay external in both bundles so it is never inlined.
    const missingIn: string[] = []
    if (!cli.has(dep)) missingIn.push('CLI_EXTERNALS')
    if (!sdk.has(dep)) missingIn.push('SDK_EXTERNALS')
    if (missingIn.length > 0) {
      errors.push(
        `${dep} is an OPTIONAL_RUNTIME_EXTERNAL but missing from ${missingIn.join(' and ')} (it must never be bundled).`,
      )
    }
  }

  return { ok: errors.length === 0, errors }
}
