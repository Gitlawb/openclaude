// Turn a tool_use block's (name, input) into a short human-readable
// summary line and an optional structured body (diffs, todo lists, etc.).
//
// This is a pragmatic port of what the TUI shows inline: "Edit foo.ts",
// "Bash: npm run build", "Read src/app.vue", + expandable details.

export type DiffLine =
  | { kind: 'context'; text: string }
  | { kind: 'removed'; text: string }
  | { kind: 'added'; text: string }

export type ToolBody =
  | { kind: 'none' }
  | { kind: 'json'; text: string }
  | { kind: 'command'; command: string; description?: string }
  | { kind: 'path'; path: string; detail?: string }
  | { kind: 'diff'; path: string; removed: string; added: string }
  | { kind: 'write'; path: string; content: string }
  | { kind: 'todos'; todos: Array<{ status: string; content: string; activeForm?: string }> }
  | { kind: 'text'; text: string }

export interface ToolSummary {
  name: string
  label: string
  body: ToolBody
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function shortenPath(path: string): string {
  // Show last two segments for compactness: "src/components/Foo.vue"
  if (!path) return path
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 3) return path
  return '…/' + parts.slice(-3).join('/')
}

function firstLine(s: string): string {
  const i = s.indexOf('\n')
  return i === -1 ? s : s.slice(0, i)
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

export function summariseTool(name: string, input: unknown): ToolSummary {
  const inp = (input && typeof input === 'object' ? input : {}) as Record<
    string,
    unknown
  >

  switch (name) {
    case 'Edit':
    case 'FileEdit':
    case 'MultiEdit': {
      const path = asString(inp.file_path)
      return {
        name,
        label: `Редагування ${shortenPath(path) || '<файл>'}`,
        body: path
          ? {
              kind: 'diff',
              path,
              removed: asString(inp.old_string),
              added: asString(inp.new_string),
            }
          : { kind: 'json', text: safeJson(input) },
      }
    }
    case 'Write':
    case 'FileWrite': {
      const path = asString(inp.file_path)
      return {
        name,
        label: `Запис ${shortenPath(path) || '<файл>'}`,
        body: path
          ? { kind: 'write', path, content: asString(inp.content) }
          : { kind: 'json', text: safeJson(input) },
      }
    }
    case 'Read':
    case 'FileRead': {
      const path = asString(inp.file_path)
      let detail: string | undefined
      if (typeof inp.offset === 'number' || typeof inp.limit === 'number') {
        const off = typeof inp.offset === 'number' ? inp.offset : 1
        const lim = typeof inp.limit === 'number' ? inp.limit : undefined
        detail = lim ? `рядки ${off}–${off + lim - 1}` : `з рядка ${off}`
      }
      return {
        name,
        label: `Читання ${shortenPath(path) || '<файл>'}`,
        body: { kind: 'path', path, detail },
      }
    }
    case 'Bash':
    case 'PowerShell': {
      const cmd = asString(inp.command)
      return {
        name,
        label: `${name}: ${firstLine(cmd).slice(0, 60)}` +
          (firstLine(cmd).length > 60 ? '…' : ''),
        body: {
          kind: 'command',
          command: cmd,
          description: asString(inp.description),
        },
      }
    }
    case 'Glob': {
      const pattern = asString(inp.pattern)
      const path = asString(inp.path)
      return {
        name,
        label: path ? `Пошук файлів ${pattern} в ${shortenPath(path)}` : `Пошук файлів ${pattern}`,
        body: { kind: 'json', text: safeJson(input) },
      }
    }
    case 'Grep': {
      const pattern = asString(inp.pattern)
      const path = asString(inp.path)
      return {
        name,
        label: path
          ? `Пошук "${pattern}" в ${shortenPath(path)}`
          : `Пошук "${pattern}"`,
        body: { kind: 'json', text: safeJson(input) },
      }
    }
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList':
    case 'TaskGet': {
      const subject = asString(inp.subject)
      const status = asString(inp.status)
      if (name === 'TaskCreate') return { name, label: `Задача: ${subject || '…'}`, body: { kind: 'json', text: safeJson(input) } }
      if (name === 'TaskUpdate') return { name, label: `Оновлення задачі${status ? ` → ${status}` : ''}`, body: { kind: 'json', text: safeJson(input) } }
      if (name === 'TaskList') return { name, label: 'Список задач', body: { kind: 'none' } }
      return { name, label: `Задача #${asString(inp.taskId)}`, body: { kind: 'json', text: safeJson(input) } }
    }
    case 'TodoWrite': {
      const todos = Array.isArray(inp.todos)
        ? (inp.todos as Array<Record<string, unknown>>).map(t => ({
            status: asString(t.status) || 'pending',
            content: asString(t.content) || asString(t.subject) || '',
            activeForm: asString(t.activeForm) || undefined,
          }))
        : []
      return {
        name,
        label: `Задачі (${todos.length})`,
        body: { kind: 'todos', todos },
      }
    }
    case 'WebFetch': {
      const url = asString(inp.url)
      return {
        name,
        label: `Завантаження ${url}`,
        body: { kind: 'json', text: safeJson(input) },
      }
    }
    case 'WebSearch': {
      const query = asString(inp.query)
      return {
        name,
        label: `Пошук в інтернеті "${query}"`,
        body: { kind: 'json', text: safeJson(input) },
      }
    }
    case 'AskUserQuestion': {
      const questions = Array.isArray(inp.questions) ? inp.questions as Array<Record<string, unknown>> : []
      const firstQ = questions[0]
      const qText = firstQ ? asString(firstQ.question) : ''
      return {
        name,
        label: qText ? `Питання: ${qText.slice(0, 60)}${qText.length > 60 ? '…' : ''}` : 'Питання до користувача',
        body: { kind: 'json', text: safeJson(input) },
      }
    }
    case 'EnterPlanMode': {
      return { name, label: 'Режим планування', body: { kind: 'none' } }
    }
    case 'ExitPlanMode': {
      return { name, label: 'Вихід з режиму планування', body: { kind: 'json', text: safeJson(input) } }
    }
    case 'Task':
    case 'Agent': {
      const desc = asString(inp.description)
      return {
        name,
        label: desc ? `Агент: ${desc}` : 'Виклик агента',
        body: { kind: 'json', text: safeJson(input) },
      }
    }
    default: {
      return {
        name,
        label: name,
        body: { kind: 'json', text: safeJson(input) },
      }
    }
  }
}

/** Normalize a tool_result content — may be string or rich blocks. */
export function normaliseToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return safeJson(content)
  const parts: string[] = []
  for (const b of content as Array<Record<string, unknown>>) {
    if (b && typeof b === 'object') {
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
      else parts.push(safeJson(b))
    }
  }
  return parts.join('\n')
}
