export type QuerySource =
  | 'repl_main_thread'
  | 'sdk'
  | 'compact'
  | 'side_question'
  | 'side_query'
  | 'auto_mode'
  | 'model_validation'
  | 'permission_explainer'
  | 'generate_session_title'
  | 'teleport_generate_title'
  | 'agent:default'
  | 'agent:custom'
  | `agent:builtin:${string}`
  | `repl_main_thread:outputStyle:${string}`
  | (string & {})
