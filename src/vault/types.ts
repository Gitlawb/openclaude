export type ProviderType = 'claude' | 'cursor' | 'gemini' | 'generic'

export type VaultConfig = {
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
