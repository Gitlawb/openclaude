export const NO_CONTENT_MESSAGE = '(no content)'

// Semantic assistant boundary injected by the OpenAI shim when a 'tool' role
// message must be followed by an 'assistant' message (Mistral / Devstral
// strict role sequence).  The query loop detects this text to decide whether
// to continue the tool-execution path or treat the turn as stalled.
//
// IMPORTANT: if you change this string, update the detection in query.ts as
// well — both places must stay in sync.
export const TOOL_RESULTS_RECEIVED_MARKER = '[Tool results received]'
