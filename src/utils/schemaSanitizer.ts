const OPENAI_INCOMPATIBLE_SCHEMA_KEYWORDS = new Set([
  '$comment',
  '$schema',
  'default',
  'else',
  'examples',
  'format',
  'if',
  'maxLength',
  'maximum',
  'minLength',
  'minimum',
  'multipleOf',
  'pattern',
  'patternProperties',
  'propertyNames',
  'then',
  'unevaluatedProperties',
])

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stripSchemaKeywords(schema: unknown, keywords: Set<string>): unknown {
  if (Array.isArray(schema)) {
    return schema.map(item => stripSchemaKeywords(item, keywords))
  }

  if (!isSchemaRecord(schema)) {
    return schema
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties' && isSchemaRecord(value)) {
      const sanitizedProps: Record<string, unknown> = {}
      for (const [propName, propSchema] of Object.entries(value)) {
        sanitizedProps[propName] = stripSchemaKeywords(propSchema, keywords)
      }
      result[key] = sanitizedProps
      continue
    }

    if (keywords.has(key)) {
      continue
    }

    result[key] = stripSchemaKeywords(value, keywords)
  }

  return result
}

function deepEqualJsonValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false

  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((value, index) => deepEqualJsonValue(value, b[index]))
    )
  }

  if (isSchemaRecord(a) && isSchemaRecord(b)) {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    return (
      aKeys.length === bKeys.length &&
      aKeys.every(key => key in b && deepEqualJsonValue(a[key], b[key]))
    )
  }

  return false
}

function matchesJsonSchemaType(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    case 'array':
      return Array.isArray(value)
    case 'null':
      return value === null
    default:
      return true
  }
}

function getJsonSchemaTypes(record: Record<string, unknown>): string[] {
  const raw = record.type
  if (typeof raw === 'string') {
    return [raw]
  }
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === 'string')
  }
  return []
}

function schemaAllowsValue(schema: Record<string, unknown>, value: unknown): boolean {
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some(item =>
      schemaAllowsValue(sanitizeSchemaForOpenAICompat(item), value),
    )
  }

  if (Array.isArray(schema.oneOf)) {
    return (
      schema.oneOf.filter(item =>
        schemaAllowsValue(sanitizeSchemaForOpenAICompat(item), value),
      ).length === 1
    )
  }

  if (Array.isArray(schema.allOf)) {
    return schema.allOf.every(item =>
      schemaAllowsValue(sanitizeSchemaForOpenAICompat(item), value),
    )
  }

  if ('const' in schema && !deepEqualJsonValue(schema.const, value)) {
    return false
  }

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some(item => deepEqualJsonValue(item, value))) {
      return false
    }
  }

  const types = getJsonSchemaTypes(schema)
  if (types.length > 0 && !types.some(type => matchesJsonSchemaType(type, value))) {
    return false
  }

  return true
}

function sanitizeTypeField(record: Record<string, unknown>): void {
  const allowed = new Set([
    'string',
    'number',
    'integer',
    'boolean',
    'object',
    'array',
    'null',
  ])

  const raw = record.type
  if (typeof raw === 'string') {
    if (!allowed.has(raw)) delete record.type
    return
  }

  if (!Array.isArray(raw)) return

  const filtered = raw.filter(
    (value, index): value is string =>
      typeof value === 'string' &&
      allowed.has(value) &&
      raw.indexOf(value) === index,
  )

  if (filtered.length === 0) {
    delete record.type
  } else if (filtered.length === 1) {
    record.type = filtered[0]
  } else {
    record.type = filtered
  }
}

/**
 * Sanitize JSON Schema into a shape OpenAI-compatible providers and Codex
 * strict-mode tooling are more likely to accept. This strips provider-rejected
 * keywords while keeping enum/const cleanup defensive for imperfect MCP schemas.
 */
export function sanitizeSchemaForOpenAICompat(
  schema: unknown,
): Record<string, unknown> {
  const stripped = stripSchemaKeywords(schema, OPENAI_INCOMPATIBLE_SCHEMA_KEYWORDS)
  if (!isSchemaRecord(stripped)) {
    return {}
  }

  const record = { ...stripped }

  sanitizeTypeField(record)

  if (isSchemaRecord(record.properties)) {
    const sanitizedProps: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record.properties)) {
      sanitizedProps[key] = sanitizeSchemaForOpenAICompat(value)
    }
    record.properties = sanitizedProps
  }

  if ('items' in record) {
    if (Array.isArray(record.items)) {
      record.items = record.items.map(item =>
        sanitizeSchemaForOpenAICompat(item),
      )
    } else {
      record.items = sanitizeSchemaForOpenAICompat(record.items)
    }
  }

  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(record[key])) {
      record[key] = record[key].map(item =>
        sanitizeSchemaForOpenAICompat(item),
      )
    }
  }

  const properties = isSchemaRecord(record.properties)
    ? record.properties
    : undefined

  if (Array.isArray(record.required) && properties) {
    record.required = record.required.filter(
      (value): value is string => typeof value === 'string' && value in properties,
    )
  }

  const schemaWithoutEnum = { ...record }
  delete schemaWithoutEnum.enum

  if (Array.isArray(record.enum)) {
    const filteredEnum = record.enum.filter(value =>
      schemaAllowsValue(schemaWithoutEnum, value),
    )
    if (filteredEnum.length > 0) {
      record.enum = filteredEnum
    } else {
      delete record.enum
    }
  }

  const schemaWithoutConst = { ...record }
  delete schemaWithoutConst.const
  if ('const' in record && !schemaAllowsValue(schemaWithoutConst, record.const)) {
    delete record.const
  }

  return record
}
