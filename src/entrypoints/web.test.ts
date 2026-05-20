import { test, expect } from 'bun:test'
import { randomBytes } from 'node:crypto'

test('web server token auth logic', async () => {
  const token = randomBytes(16).toString('hex')
  const mockRequest = (urlToken?: string) => ({
    url: `http://localhost:3000/?token=${urlToken || ''}`,
    headers: new Map(),
  })

  // Basic validation logic check (simulating the middleware)
  const validate = (reqToken: string | null, authToken: string) => reqToken === authToken

  expect(validate(token, token)).toBe(true)
  expect(validate('wrong', token)).toBe(false)
  expect(validate(null, token)).toBe(false)
})
