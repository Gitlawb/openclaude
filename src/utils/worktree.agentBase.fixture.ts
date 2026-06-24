// Child-process fixture for worktree.agentBase.test.ts.
//
// createAgentWorktree shells out to git via execFileNoThrow.js, which other
// test suites mock with `mock.module` — a process-global override Bun cannot
// reliably revert. Running the call in this standalone process (which loads
// only worktree.ts and its real dependencies, never any *.test.ts) guarantees
// it sees the genuine modules, immune to whatever the shared test process has
// leaked.
//
// Usage: bun run worktree.agentBase.fixture.ts <cfgDir> <repoDir> <name>
// Prints { worktreePath } as JSON on stdout.
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from './envUtils.js'
import { createAgentWorktree } from './worktree.js'

const [cfgDir, repoDir, name] = process.argv.slice(2)

if (!cfgDir || !repoDir || !name) {
  process.stderr.write('usage: <cfgDir> <repoDir> <name>\n')
  process.exit(2)
}

setClaudeConfigHomeDirForTesting(cfgDir)
getClaudeConfigHomeDir.cache?.clear?.()

const result = await createAgentWorktree(name, { cwd: repoDir })
process.stdout.write(JSON.stringify({ worktreePath: result.worktreePath }))
