/**
 * Feature extraction for task-tier classification.
 * Pure heuristics — no model calls.
 */

export type TaskSignals = {
  text: string
  charCount: number
  hasImage: boolean
  pathMentions: number
  multiFileHints: boolean
  architectureKeywords: boolean
  hardTaskKeywords: boolean
  readOnlyHints: boolean
  visionKeywords: boolean
}

const PATH_RE =
  /(?:[A-Za-z]:)?(?:\/|\\)?(?:[\w.-]+[\\/])+[\w.-]+\.\w{1,12}\b|`[^`]+\.\w{1,12}`/g

const MULTI_FILE_RE =
  /\b(multi[- ]?file|v[aá]rios arquivos|várias pastas|varios arquivos|across (?:the )?(?:codebase|repo)|em v[aá]rios m[oó]dulos|several files|multiple files|whole project|todo o projeto)\b/i

const ARCHITECTURE_RE =
  /\b(arquitetura|architecture|redesenh|redesign|refactor(?:ing)? (?:grande|large|major)|migra[cç][aã]o|migration|do zero|from scratch|system design|microservi[cç]os|microservices|auth(?:entication|oriza)|security audit|auditoria de seguran[cç]a)\b/i

const HARD_TASK_RE =
  /\b(debug(?:gar)? (?:dif[ií]cil|hard|complexo)|root cause|race condition|deadlock|performance profiling|otimiza[cç][aã]o profunda|production outage|incidente)\b/i

const READ_ONLY_RE =
  /\b(s[oó] leia|only read|explain|explica|o que (?:[eé]|faz)|what does|summarize|resume|n[aã]o edite|do not edit|sem alterar)\b/i

const VISION_RE =
  /\b(screenshot|imagem|image|print|foto|photo|ui mock|wireframe|diagrama visual)\b/i

export type ExtractTaskSignalsInput = {
  text?: string
  hasImage?: boolean
}

export function extractTaskSignals(
  input: ExtractTaskSignalsInput,
): TaskSignals {
  const text = (input.text ?? '').trim()
  const pathMentions = text.match(PATH_RE)?.length ?? 0

  return {
    text,
    charCount: text.length,
    hasImage: Boolean(input.hasImage),
    pathMentions,
    multiFileHints: MULTI_FILE_RE.test(text),
    architectureKeywords: ARCHITECTURE_RE.test(text),
    hardTaskKeywords: HARD_TASK_RE.test(text),
    readOnlyHints: READ_ONLY_RE.test(text),
    visionKeywords: VISION_RE.test(text),
  }
}
