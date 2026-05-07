import { describe, expect, mock, test } from 'bun:test'

import {
  CODEX_DEVICE_CODE_URL,
  requestCodexDeviceCode,
} from './codexDeviceFlow.js'

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('requestCodexDeviceCode', () => {
  test('parses successful device-code response and sends expected form fields', async () => {
    let requestInit: RequestInit | undefined
    const fetchImpl = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestInit = init
      return jsonResponse({
        device_code: 'device-code',
        user_code: 'USER-CODE',
        verification_uri: 'https://auth.openai.com/activate',
        verification_uri_complete:
          'https://auth.openai.com/activate?user_code=USER-CODE',
        expires_in: 900,
        interval: 5,
      })
    })

    const result = await requestCodexDeviceCode({
      clientId: 'client-id',
      scope: 'scope-a scope-b',
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledWith(CODEX_DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: expect.any(URLSearchParams),
      signal: expect.any(AbortSignal),
    })
    expect((requestInit?.body as URLSearchParams).get('client_id')).toBe(
      'client-id',
    )
    expect((requestInit?.body as URLSearchParams).get('scope')).toBe(
      'scope-a scope-b',
    )
    expect((requestInit?.body as URLSearchParams).get('originator')).toBe(
      'codex_cli_rs',
    )
    expect(
      (requestInit?.body as URLSearchParams).get('id_token_add_organizations'),
    ).toBe('true')
    expect(result).toEqual({
      deviceCode: 'device-code',
      userCode: 'USER-CODE',
      verificationUri: 'https://auth.openai.com/activate',
      verificationUriComplete:
        'https://auth.openai.com/activate?user_code=USER-CODE',
      expiresIn: 900,
      interval: 5,
    })
  })

  test('aborts a hanging request after the per-request timeout', async () => {
    const fetchImpl = mock(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          })
        })
        throw new Error('unreachable')
      },
    )

    await expect(
      requestCodexDeviceCode({
        fetchImpl,
        requestTimeoutMs: 1,
      }),
    ).rejects.toThrow()
  })

  test('honors caller abort signal', async () => {
    let requestSignal: AbortSignal | undefined
    const controller = new AbortController()
    const fetchImpl = mock(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        requestSignal = init?.signal
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          })
        })
        throw new Error('unreachable')
      },
    )

    const result = requestCodexDeviceCode({
      fetchImpl,
      signal: controller.signal,
      requestTimeoutMs: 60_000,
    })
    await Bun.sleep(0)
    controller.abort(new Error('cancelled'))

    await expect(result).rejects.toThrow('cancelled')
    expect(requestSignal?.aborted).toBe(true)
  })
})
