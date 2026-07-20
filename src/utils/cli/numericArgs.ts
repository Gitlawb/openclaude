import { InvalidArgumentError } from '@commander-js/extra-typings'

/**
 * Commander argParser for options that must be a positive integer.
 *
 * A bare `.argParser(Number)` accepts anything Number() coerces without
 * complaint: "abc"/"10x" become NaN, "0" stays 0, "1e999" becomes Infinity,
 * "2.5" stays a float, "-5" stays negative. For a cap like --max-turns those
 * all defeat the limit — the enforcement check `maxTurns && turnCount > maxTurns`
 * is falsy for NaN/0 (so the agent runs unbounded) and negatives exit
 * immediately.
 *
 * The bound is Number.isSafeInteger, not Number.isInteger: values past 2^53-1
 * are integers but no longer round-trip, so `--max-turns 9007199254740993`
 * would silently become 9007199254740992, and 1e308 would pass as a cap that
 * can never be reached. Matches the maxSteps check in runAgent.ts.
 */
export function parsePositiveIntArg(name: string, value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`${name} must be a positive integer`)
  }
  return parsed
}
