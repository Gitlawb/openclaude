/**
 * Type declarations for markdown file imports.
 * The skills system imports .md files as string content.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare module '*.md' {
  const content: string
  export default content
}
declare module '*SKILL.md' {
  const content: string
  export default content
}
