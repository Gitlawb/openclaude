export function isPromptTypingSuppressionActive(
  isPromptInputActive: boolean,
  inputValue: string,
): boolean {
  return isPromptInputActive || inputValue.trim().length > 0
}
