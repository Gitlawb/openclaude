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

/**
 * Commander argParser for options that must be a positive amount, decimals
 * allowed (e.g. a dollar budget).
 *
 * Number.isFinite rather than a bare !isNaN check: `Number('Infinity')` is not
 * NaN and is greater than zero, so an unbounded budget would otherwise pass
 * validation for a spending cap.
 *
 * Finite is not sufficient on its own though. The cap is enforced as
 * `getTotalCost() >= maxBudgetUsd`, so it has to be a dollar figure real
 * spending can actually reach: 1e308 is finite and positive but the guard can
 * never fire, which is the unbounded-budget hole again with a different
 * literal. Anything past Number.MAX_SAFE_INTEGER also stops round-tripping,
 * so the enforced cap would differ from the one the user typed. Bound at the
 * safe-integer range -- far above any real budget, below where either problem
 * starts.
 *
 * The safe-integer bound alone misses one case: a fractional value just under
 * it can still lose precision. `Number('9007199254740990.5')` rounds to
 * 9007199254740990, which is <= MAX_SAFE_INTEGER yet no longer the value that
 * was typed, so the enforced cap silently shifts. A double round-trips only
 * ~15 significant decimal digits, so a fractional input carrying more than that
 * is rejected. (Whole-number precision is already bounded by MAX_SAFE_INTEGER,
 * which legitimately carries 16 digits, so the digit check is gated on a
 * decimal point to avoid rejecting the boundary integer itself.)
 */
export function parsePositiveAmountArg(name: string, value: string): number {
  const parsed = Number(value)
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    parsed > Number.MAX_SAFE_INTEGER
  ) {
    throw new InvalidArgumentError(
      `${name} must be a positive number greater than 0`,
    )
  }
  if (value.includes('.') && significantDigitCount(value) > 15) {
    throw new InvalidArgumentError(
      `${name} has more precision than can be represented exactly`,
    )
  }
  return parsed
}

/**
 * Count the significant decimal digits in a numeric string: drop the sign, any
 * exponent suffix, the decimal point, then leading and trailing zeros (neither
 * of which carries precision). "1000.50" -> "10005" -> 5; "9007199254740990.5"
 * -> 17. Used to reject caps a double cannot hold exactly.
 */
function significantDigitCount(value: string): number {
  const mantissa = value
    .trim()
    .replace(/^[+-]/, '')
    .replace(/[eE][+-]?\d+$/, '')
  const digitsOnly = mantissa.replace('.', '')
  return digitsOnly.replace(/^0+/, '').replace(/0+$/, '').length
}
