// Stub for external builds — the real hook is internal only.
//
// Self-contained: no relative imports. Typecheck sees this file at
// scripts/external-stubs/src/moreright/ before overlay, where ../types/
// would resolve to scripts/external-stubs/src/types/ (doesn't exist).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type M = any;
export function useMoreRight(_args: {
  enabled: boolean;
  setMessages: (action: M[] | ((prev: M[]) => M[])) => void;
  inputValue: string;
  setInputValue: (s: string) => void;
  setToolJSX: (args: M) => void;
}): {
  onBeforeQuery: (input: string, all: M[], n: number) => Promise<boolean>;
  onTurnComplete: (all: M[], aborted: boolean) => Promise<void>;
  render: () => null;
} {
  return {
    onBeforeQuery: async () => true,
    onTurnComplete: async () => {},
    render: () => null
  };
}
