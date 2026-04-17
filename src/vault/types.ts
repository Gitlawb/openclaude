export type ProviderType = 'claude' | 'cursor' | 'gemini' | 'generic'

/** Pointer to a vault root directory. PIF-B will extend with sync metadata. */
export type VaultRef = {
  path: string
}

export type VaultConfig = {
  /** Project-local vault. Always present. */
  local: VaultRef
  /** Optional global vault. Null when the dev declined or hasn't bootstrapped (PIF-B). */
  global: VaultRef | null
  provider: ProviderType
  projectName: string
  projectRoot: string
  /**
   * @deprecated Use `local.path`. Kept as an alias for backward compat with
   * the existing `cfg.vaultPath` access sites (~100 across mapper, onboard,
   * scaffold, upgrade, lint, tests). Config builders MUST populate both;
   * always equals `local.path`. Will be removed in a future cleanup feature.
   */
  vaultPath: string
}

/**
 * Legacy single-vault shape from before PIF-A. Retained ONLY for the
 * `adaptLegacyConfig` adapter — do NOT add new fields here.
 */
export type LegacyVaultConfig = {
  vaultPath: string
  provider: ProviderType
  projectName: string
  projectRoot: string
}

export type VaultManifest = {
  createdAt: string
  updatedAt: string
  provider: ProviderType
  docs: string[]
}

export type GitInfo = {
  remoteUrl: string | null
  branch: string
  isDirty: boolean
}

export type ManifestInfo = {
  path: string
  type: string // 'npm' | 'cargo' | 'python' | 'go' | 'maven' | 'ruby' | 'composer'
  language: string
  framework?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
}

export type StructureInfo = {
  isMonorepo: boolean
  topLevelDirs: string[]
  entryPoints: string[]
  workspaces?: string[]
}

export type TestingInfo = {
  framework?: string
  testDirs: string[]
  testCommands: string[]
  coverageConfig?: string
}

export type DocsInfo = {
  hasReadme: boolean
  readmePath?: string
  readmeFirstParagraph?: string
  hasDocsDir: boolean
  hasExistingClaudeMd: boolean
}

export type IndexResult = {
  git: GitInfo | null
  languages: string[]
  primaryLanguage: string | null
  manifests: ManifestInfo[]
  structure: StructureInfo
  testing: TestingInfo
  docs: DocsInfo
  commands: {
    build?: string
    test?: string
    lint?: string
    dev?: string
    [key: string]: string | undefined
  }
  fileCount: number
  isLargeRepo: boolean
}
