export type ModuleCandidate = {
  slug: string
  sourcePath: string
  files: string[]
  language: 'typescript' | 'javascript'
}
