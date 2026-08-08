/**
 * Instruction handed to the forked ctx-agent. The span's actual messages are
 * supplied as fork context; this asks for a faithful, compact replacement summary.
 * Provider-neutral: it runs on whatever model/provider the session is using.
 */
export const CTX_AGENT_INSTRUCTION = [
  'You are compacting an older portion of this conversation to save context.',
  'Write a single compact summary of the conversation messages above so that',
  'work can continue without re-reading them. Preserve, concisely:',
  '- decisions made and the reasoning behind them',
  '- the current state, configuration, and any values of record',
  '- file paths, identifiers, commands, and other concrete references touched',
  '- unresolved threads, open questions, and TODOs',
  '- any facts later steps depend on',
  '',
  'Rules: include only information present in the messages above; do not invent',
  'or speculate. No preamble, no headings, no closing remarks — output only the',
  'summary prose. Be substantially shorter than the original.',
].join('\n')
