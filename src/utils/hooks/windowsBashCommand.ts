export function getWindowsBashHookCommand(command: string): string {
  // Read only the first shell word: a .sh argument or a script inside a
  // compound command must not turn the whole command into a bash script path.
  const word = command.match(
    /^\s*((?:[^\s"'\\;&|<>()`]|\\[\s\S]|"(?:[^"\\]|\\[\s\S])*"|'[^']*')+)(?=\s|[;&|<>]|$)/,
  )?.[1]
  if (!word || /^(?:[A-Za-z_][A-Za-z_0-9]*=|#)/.test(word)) return command
  if (/^\s*\(\s*\)/.test(command.trimStart().slice(word.length))) return command

  // Require a literal suffix, not .sh inside a parameter expansion such as
  // "${HOOK_COMMAND:-./hook.sh}" whose actual executable is unknown here.
  return /\.sh["']?$/.test(word) ? `bash ${command}` : command
}
