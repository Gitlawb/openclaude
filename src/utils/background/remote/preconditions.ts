// Stub: remote background services not available in Forge builds

export async function checkRepoForRemoteAccess(): Promise<{ eligible: false }> {
  return { eligible: false }
}

export async function checkGithubAppInstalled(): Promise<false> {
  return false
}

export async function checkIsGitClean(): Promise<true> {
  return true
}

export async function checkNeedsClaudeAiLogin(): Promise<false> {
  return false
}

export async function checkHasRemoteEnvironment(): Promise<false> {
  return false
}

export async function checkIsInGitRepo(): Promise<true> {
  return true
}
