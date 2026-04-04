/* eslint-disable */

import type { PublicApiAuth } from '../../common/v1/auth.js'

export interface GitHubActionsMetadata {
  actor_id?: string | undefined
  repository_id?: string | undefined
  repository_owner_id?: string | undefined
}

export interface EnvironmentMetadata {
  platform?: string | undefined
  node_version?: string | undefined
  terminal?: string | undefined
  package_managers?: string | undefined
  runtimes?: string | undefined
  is_running_with_bun?: boolean | undefined
  is_ci?: boolean | undefined
  is_claubbit?: boolean | undefined
  is_github_action?: boolean | undefined
  is_claude_code_action?: boolean | undefined
  is_claude_ai_auth?: boolean | undefined
  version?: string | undefined
  github_event_name?: string | undefined
  github_actions_runner_environment?: string | undefined
  github_actions_runner_os?: string | undefined
  github_action_ref?: string | undefined
  wsl_version?: string | undefined
  github_actions_metadata?: GitHubActionsMetadata | undefined
  arch?: string | undefined
  is_claude_code_remote?: boolean | undefined
  remote_environment_type?: string | undefined
  claude_code_container_id?: string | undefined
  claude_code_remote_session_id?: string | undefined
  tags?: string[] | undefined
  deployment_environment?: string | undefined
  is_conductor?: boolean | undefined
  version_base?: string | undefined
  coworker_type?: string | undefined
  build_time?: string | undefined
  is_local_agent_mode?: boolean | undefined
  linux_distro_id?: string | undefined
  linux_distro_version?: string | undefined
  linux_kernel?: string | undefined
  vcs?: string | undefined
  platform_raw?: string | undefined
}

export interface SlackContext {
  slack_team_id?: string | undefined
  is_enterprise_install?: boolean | undefined
  trigger?: string | undefined
  creation_method?: string | undefined
}

export interface ClaudeCodeInternalEvent {
  event_name?: string | undefined
  client_timestamp?: Date | undefined
  model?: string | undefined
  session_id?: string | undefined
  user_type?: string | undefined
  betas?: string | undefined
  env?: EnvironmentMetadata | undefined
  entrypoint?: string | undefined
  agent_sdk_version?: string | undefined
  is_interactive?: boolean | undefined
  client_type?: string | undefined
  process?: string | undefined
  additional_metadata?: string | undefined
  auth?: PublicApiAuth | undefined
  server_timestamp?: Date | undefined
  event_id?: string | undefined
  device_id?: string | undefined
  swe_bench_run_id?: string | undefined
  swe_bench_instance_id?: string | undefined
  swe_bench_task_id?: string | undefined
  email?: string | undefined
  agent_id?: string | undefined
  parent_session_id?: string | undefined
  agent_type?: string | undefined
  slack?: SlackContext | undefined
  team_name?: string | undefined
  skill_name?: string | undefined
  plugin_name?: string | undefined
  marketplace_name?: string | undefined
}

export const ClaudeCodeInternalEvent = {
  fromJSON(object: any): ClaudeCodeInternalEvent {
    return object ?? {}
  },

  toJSON(message: ClaudeCodeInternalEvent): unknown {
    return message ?? {}
  },

  create<I extends ClaudeCodeInternalEvent>(
    base?: I,
  ): ClaudeCodeInternalEvent {
    return base ?? {}
  },

  fromPartial<I extends ClaudeCodeInternalEvent>(
    object: I,
  ): ClaudeCodeInternalEvent {
    return object ?? {}
  },
}
