import { expect, test } from 'bun:test'

import {
  exchangeJwtAuthGrant,
  requestJwtAuthorizationGrant,
} from './xaa.js'

test('XAA token-exchange errors never include provider-controlled secret text', async () => {
  const echoedSecret = 'identity-secret-value-7Qm2'

  const request = requestJwtAuthorizationGrant({
    tokenEndpoint: 'https://idp.example.test/token',
    audience: 'https://as.example.test',
    resource: 'https://mcp.example.test/mcp',
    idToken: echoedSecret,
    clientId: 'idp-client',
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: `provider echoed ${echoedSecret}`,
        }),
        { status: 400 },
      ),
  })

  await expect(request).rejects.not.toThrow(echoedSecret)
  await expect(request).rejects.toThrow(/HTTP 400/)
})

test('XAA jwt-bearer errors never include provider-controlled secret text', async () => {
  const echoedSecret = 'assertion-secret-value-9Vr4'

  const request = exchangeJwtAuthGrant({
    tokenEndpoint: 'https://as.example.test/token',
    assertion: echoedSecret,
    clientId: 'as-client',
    clientSecret: 'client-secret',
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: `provider echoed ${echoedSecret}`,
        }),
        { status: 400 },
      ),
  })

  await expect(request).rejects.not.toThrow(echoedSecret)
  await expect(request).rejects.toThrow(/HTTP 400/)
})
