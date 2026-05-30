import { SDKRateLimitError } from '@gitlawb/openclaude/sdk'

// Constructor should accept (message?, resetsAt?, rateLimitType?)
const err = new SDKRateLimitError('rate limited', 12345, 'requests')

// Properties should be accessible on the instance
const resets: number | undefined = err.resetsAt
const rateType: string | undefined = err.rateLimitType

console.log(resets, rateType)