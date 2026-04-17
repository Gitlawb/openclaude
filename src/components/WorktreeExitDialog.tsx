import React, { useEffect, useState } from 'react';
import type { CommandResultDisplay } from 'src/commands.js';
import { logEvent } from 'src/services/analytics/index.js';
import { logForDebugging } from 'src/utils/debug.js';
import { Box, Text } from '../ink.js';
import { execFileNoThrow } from '../utils/execFileNoThrow.js';
import { getPlansDirectory } from '../utils/plans.js';
import { setCwd } from '../utils/Shell.js';
import { cleanupWorktree, getCurrentWorktreeSession, keepWorktree, killTmuxSession } from '../utils/worktree.js';
import { Select } from './CustomSelect/select.js';
import { Dialog } from './design-system/Dialog.js';
import { Spinner } from './Spinner.js';

// Inline require breaks the cycle this file would otherwise close:
// sessionStorage → commands → exit → ExitFlow → here. All call sites
// are inside callbacks, so the lazy require never sees an undefined import.
function recordWorktreeExit(): void {
  /* eslint-disable @typescript-eslint/no-require-imports */
  ;
  (require('../utils/sessionStorage.js') as typeof import('../utils/sessionStorage.js')).saveWorktreeState(null);
  /* eslint-enable @typescript-eslint/no-require-imports */
}
type Props = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  onCancel?: () => void;
};
export function WorktreeExitDialog({
  onDone,
  onCancel
}: Props): React.ReactNode {
  const [status, setStatus] = useState<'loading' | 'asking' | 'keeping' | 'removing' | 'done'>('loading');
  const [changes, setChanges] = useState<string[]>([]);
  const [commitCount, setCommitCount] = useState<number>(0);
  const [resultMessage, setResultMessage] = useState<string | undefined>();
  const worktreeSession = getCurrentWorktreeSession();
  useEffect(() => {
    async function loadChanges() {
      let changeLines: string[] = [];
      const gitStatus = await execFileNoThrow('git', ['status', '--porcelain']);
      if (gitStatus.stdout) {
        changeLines = gitStatus.stdout.split('\n').filter(_ => _.trim() !== '');
        setChanges(changeLines);
      }

      // Check for commits to eject
      if (worktreeSession) {
        // Get commits in worktree that are not in original branch
        const {
          stdout: commitsStr
        } = await execFileNoThrow('git', ['rev-list', '--count', `${worktreeSession.originalHeadCommit}..HEAD`]);
        const count = parseInt(commitsStr.trim()) || 0;
        setCommitCount(count);

        // If no changes and no commits, clean up silently
        if (changeLines.length === 0 && count === 0) {
          setStatus('removing');
          void cleanupWorktree().then(() => {
            process.chdir(worktreeSession.originalCwd);
            setCwd(worktreeSession.originalCwd);
            recordWorktreeExit();
            getPlansDirectory.cache.clear?.();
            setResultMessage('Worktree видалено (без змін)');
          }).catch(error => {
            logForDebugging(`Failed to clean up worktree: ${error}`, {
              level: 'error'
            });
            setResultMessage('Не вдалося очистити worktree, все одно виходимо');
          }).then(() => {
            setStatus('done');
          });
          return;
        } else {
          setStatus('asking');
        }
      }
    }
    void loadChanges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  }, [worktreeSession]);
  useEffect(() => {
    if (status === 'done') {
      onDone(resultMessage);
    }
  }, [status, onDone, resultMessage]);
  if (!worktreeSession) {
    onDone('Активної worktree сесії не знайдено', {
      display: 'system'
    });
    return null;
  }
  if (status === 'loading' || status === 'done') {
    return null;
  }
  async function handleSelect(value: string) {
    if (!worktreeSession) return;
    const hasTmux = Boolean(worktreeSession.tmuxSessionName);
    if (value === 'keep' || value === 'keep-with-tmux') {
      setStatus('keeping');
      logEvent('tengu_worktree_kept', {
        commits: commitCount,
        changed_files: changes.length
      });
      await keepWorktree();
      process.chdir(worktreeSession.originalCwd);
      setCwd(worktreeSession.originalCwd);
      recordWorktreeExit();
      getPlansDirectory.cache.clear?.();
      if (hasTmux) {
        setResultMessage(`Worktree збережено. Ваша робота знаходиться в ${worktreeSession.worktreePath} на гілці ${worktreeSession.worktreeBranch}. Перепідключіться до tmux сесії: tmux attach -t ${worktreeSession.tmuxSessionName}`);
      } else {
        setResultMessage(`Worktree збережено. Ваша робота знаходиться в ${worktreeSession.worktreePath} на гілці ${worktreeSession.worktreeBranch}`);
      }
      setStatus('done');
    } else if (value === 'keep-kill-tmux') {
      setStatus('keeping');
      logEvent('tengu_worktree_kept', {
        commits: commitCount,
        changed_files: changes.length
      });
      if (worktreeSession.tmuxSessionName) {
        await killTmuxSession(worktreeSession.tmuxSessionName);
      }
      await keepWorktree();
      process.chdir(worktreeSession.originalCwd);
      setCwd(worktreeSession.originalCwd);
      recordWorktreeExit();
      getPlansDirectory.cache.clear?.();
      setResultMessage(`Worktree збережено в ${worktreeSession.worktreePath} на гілці ${worktreeSession.worktreeBranch}. Tmux сесію завершено.`);
      setStatus('done');
    } else if (value === 'remove' || value === 'remove-with-tmux') {
      setStatus('removing');
      logEvent('tengu_worktree_removed', {
        commits: commitCount,
        changed_files: changes.length
      });
      if (worktreeSession.tmuxSessionName) {
        await killTmuxSession(worktreeSession.tmuxSessionName);
      }
      try {
        await cleanupWorktree();
        process.chdir(worktreeSession.originalCwd);
        setCwd(worktreeSession.originalCwd);
        recordWorktreeExit();
        getPlansDirectory.cache.clear?.();
      } catch (error) {
        logForDebugging(`Failed to clean up worktree: ${error}`, {
          level: 'error'
        });
        setResultMessage('Не вдалося очистити worktree, все одно виходимо');
        setStatus('done');
        return;
      }
      const tmuxNote = hasTmux ? ' Tmux сесію завершено.' : '';
      if (commitCount > 0 && changes.length > 0) {
        setResultMessage(`Worktree видалено. ${commitCount} ${commitCount === 1 ? 'коміт' : 'комітів'} та незакомічені зміни відкинуто.${tmuxNote}`);
      } else if (commitCount > 0) {
        setResultMessage(`Worktree видалено. ${commitCount} ${commitCount === 1 ? 'коміт' : 'комітів'} на ${worktreeSession.worktreeBranch} відкинуто.${tmuxNote}`);
      } else if (changes.length > 0) {
        setResultMessage(`Worktree видалено. Незакомічені зміни відкинуто.${tmuxNote}`);
      } else {
        setResultMessage(`Worktree видалено.${tmuxNote}`);
      }
      setStatus('done');
    }
  }
  if (status === 'keeping') {
    return <Box flexDirection="row" marginY={1}>
        <Spinner />
        <Text>Зберігаємо worktree…</Text>
      </Box>;
  }
  if (status === 'removing') {
    return <Box flexDirection="row" marginY={1}>
        <Spinner />
        <Text>Видаляємо worktree…</Text>
      </Box>;
  }
  const branchName = worktreeSession.worktreeBranch;
  const hasUncommitted = changes.length > 0;
  const hasCommits = commitCount > 0;
  let subtitle = '';
  if (hasUncommitted && hasCommits) {
    subtitle = `У вас ${changes.length} незакомічених ${changes.length === 1 ? 'файл' : 'файлів'} та ${commitCount} ${commitCount === 1 ? 'коміт' : 'комітів'} на ${branchName}. Усе буде втрачено при видаленні.`;
  } else if (hasUncommitted) {
    subtitle = `У вас ${changes.length} незакомічених ${changes.length === 1 ? 'файл' : 'файлів'}. Вони будуть втрачені при видаленні worktree.`;
  } else if (hasCommits) {
    subtitle = `У вас ${commitCount} ${commitCount === 1 ? 'коміт' : 'комітів'} на ${branchName}. Гілку буде видалено разом з worktree.`;
  } else {
    subtitle = 'Ви працюєте у worktree. Збережіть її, щоб продовжити роботу там, або видаліть для очищення.';
  }
  function handleCancel() {
    if (onCancel) {
      // Abort exit and return to the session
      onCancel();
      return;
    }
    // Fallback: treat Escape as "keep" if no onCancel provided
    void handleSelect('keep');
  }
  const removeDescription = hasUncommitted || hasCommits ? 'Усі зміни та коміти будуть втрачені.' : 'Очистити директорію worktree.';
  const hasTmuxSession = Boolean(worktreeSession.tmuxSessionName);
  const options = hasTmuxSession ? [{
    label: 'Зберегти worktree та tmux сесію',
    value: 'keep-with-tmux',
    description: `Залишиться в ${worktreeSession.worktreePath}. Перепідключіться: tmux attach -t ${worktreeSession.tmuxSessionName}`
  }, {
    label: 'Зберегти worktree, завершити tmux сесію',
    value: 'keep-kill-tmux',
    description: `Зберігає worktree в ${worktreeSession.worktreePath}, завершує tmux сесію.`
  }, {
    label: 'Видалити worktree та tmux сесію',
    value: 'remove-with-tmux',
    description: removeDescription
  }] : [{
    label: 'Зберегти worktree',
    value: 'keep',
    description: `Залишиться в ${worktreeSession.worktreePath}`
  }, {
    label: 'Видалити worktree',
    value: 'remove',
    description: removeDescription
  }];
  const defaultValue = hasTmuxSession ? 'keep-with-tmux' : 'keep';
  return <Dialog title="Вихід з worktree сесії" subtitle={subtitle} onCancel={handleCancel}>
      <Select defaultFocusValue={defaultValue} options={options} onChange={handleSelect} />
    </Dialog>;
}
