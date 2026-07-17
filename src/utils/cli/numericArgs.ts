import { InvalidArgumentError } from '@commander-js/extra-typings'

/**
 * Commander argParser for options that must be a positive integer.
 *
 * A bare `.argParser(Number)` accepts anything Number() coerces without
 * complaint: "abc"/"10x" become NaN, "0" stays 0, "1e999" becomes Infinity,
 * "2.5" stays a float, "-5" stays negative. For a cap like --max-turns those
 * all defeat the limit — the enforcement check `maxTurns && turnCount > maxTurns`
 * is falsy for NaN/0 (so the agent runs unbounded) and negatives exit
 * immediately. Reject them at parse time instead, matching the validation the
 * adjacent --task-budget parser already does.
 */
export function parsePositiveIntArg(name: string, value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`${name} must be a positive integer`)
  }
  return parsed
}
