type XaaIdpCallbackParamValue = string | string[] | undefined

export type XaaIdpCallbackValidationResult =
  | { type: 'code'; code: string }
  | { type: 'error'; error: string; errorDescription: string }
  | { type: 'missing_code' }
  | { type: 'state_mismatch' }

function getFirstXaaIdpCallbackParam(
  value: XaaIdpCallbackParamValue,
): string | undefined {
  if (Array.isArray(value)) {
    return value.find(item => item.length > 0)
  }
  return value && value.length > 0 ? value : undefined
}

export function validateXaaIdpCallbackParams(
  params: {
    code?: XaaIdpCallbackParamValue
    state?: XaaIdpCallbackParamValue
    error?: XaaIdpCallbackParamValue
    error_description?: XaaIdpCallbackParamValue
  },
  expectedState: string,
): XaaIdpCallbackValidationResult {
  const code = getFirstXaaIdpCallbackParam(params.code)
  const state = getFirstXaaIdpCallbackParam(params.state)
  const error = getFirstXaaIdpCallbackParam(params.error)
  const errorDescription =
    getFirstXaaIdpCallbackParam(params.error_description) ?? ''

  if (state !== expectedState) {
    return { type: 'state_mismatch' }
  }

  if (error) {
    return { type: 'error', error, errorDescription }
  }

  if (!code) {
    return { type: 'missing_code' }
  }

  return { type: 'code', code }
}

export function shouldCompleteXaaIdpCallback(
  result: XaaIdpCallbackValidationResult,
): boolean {
  return result.type !== 'state_mismatch'
}
