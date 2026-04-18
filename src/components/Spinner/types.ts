/**
 * Spinner modes that indicate what the agent is currently doing.
 * Used by SpinnerWithVerb and related components to render appropriate
 * animations and status text.
 */
export type SpinnerMode =
  | 'requesting' // Sending request to the API
  | 'thinking' // Model is thinking (extended thinking / chain-of-thought)
  | 'responding' // Model is streaming text response
  | 'tool-input' // Model is generating tool input parameters
  | 'tool-use' // Tool is currently executing

/**
 * RGB color representation used by spinner animation color interpolation.
 */
export type RGBColor = {
  r: number
  g: number
  b: number
}
