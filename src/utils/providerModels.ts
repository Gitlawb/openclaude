/**
 * Utility functions for parsing comma-separated model names in provider profiles.
 *
 * Example: "glm-4.7, glm-4.7-flash" -> ["glm-4.7", "glm-4.7-flash"]
 * Single model: "llama3.1:8b" -> ["llama3.1:8b"]
 */

/**
 * Splits a comma-separated model field into an array of trimmed model names,
 * filtering out any empty entries.
 */
export function parseModelList(modelField: string): string[] {
  return modelField
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/**
 * Returns the first (primary) model from a comma-separated model field.
 * Falls back to the original string if parsing yields no results.
 */
export function getPrimaryModel(modelField: string): string {
  const models = parseModelList(modelField)
  return models.length > 0 ? models[0] : modelField
}

/**
 * Returns true if the model field contains more than one model.
 */
export function hasMultipleModels(modelField: string): boolean {
  return parseModelList(modelField).length > 1
}
