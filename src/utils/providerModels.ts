/**
 * Utility functions for parsing provider-profile model lists.
 *
 * Examples:
 * - "glm-4.7, glm-4.7-flash" -> ["glm-4.7", "glm-4.7-flash"]
 * - "glm-4.7; glm-4.7-flash" -> ["glm-4.7", "glm-4.7-flash"]
 * - "llama3.1:8b" -> ["llama3.1:8b"]
 */

/**
 * Splits a comma- or semicolon-separated model field into an array of trimmed
 * model names, filtering out any empty entries.
 */
export function parseModelList(modelField: string): string[] {
  return modelField
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/**
 * Returns the first (primary) model from a model-list field.
 * Falls back to the trimmed original string if parsing yields no results.
 */
export function getPrimaryModel(modelField: string): string {
  const models = parseModelList(modelField)
  return models.length > 0 ? models[0] : modelField.trim()
}

/**
 * Returns true if the model field contains more than one model.
 */
export function hasMultipleModels(modelField: string): boolean {
  return parseModelList(modelField).length > 1
}
