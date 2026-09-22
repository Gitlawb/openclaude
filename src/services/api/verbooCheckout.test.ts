import { afterEach, expect, mock, test } from 'bun:test'
import axios from 'axios'

import {
  confirmCardlessTrial,
  createCheckoutSession,
  getWhatsAppProfile,
  hasGroupSubscriptionEntitlement,
  isWooviSubscriptionActive,
  startCardlessTrial,
} from './verbooCheckout.js'

const originalPost = axios.post
const originalGet = axios.get
const GROUP_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_GROUP_ID = '22222222-2222-4222-8222-222222222222'
const VERIFICATION_ID = '33333333-3333-4333-8333-333333333333'
const SUBSCRIPTION_ID = '44444444-4444-4444-8444-444444444444'
const ATTEMPT_ID = '55555555-5555-4555-8555-555555555555'

afterEach(() => {
  axios.post = originalPost
  axios.get = originalGet
})

test('sends the explicit Woovi method and payer data to checkout', async () => {
  const post = mock(async () => ({
    data: {
      data: {
        mode: 'woovi' as const,
        attemptId: ATTEMPT_ID,
        wooviQrCode: '000201',
        wooviSubscriptionId: 'woovi-subscription',
      },
    },
  }))
  axios.post = post as typeof axios.post

  await expect(
    createCheckoutSession('access-token', GROUP_ID, {
      paymentMethod: 'woovi',
      woovi: { taxId: '52998224725', phone: '11999999999' },
    }),
  ).resolves.toEqual({
    mode: 'woovi',
    attemptId: ATTEMPT_ID,
    wooviQrCode: '000201',
    wooviSubscriptionId: 'woovi-subscription',
  })

  expect(post).toHaveBeenCalledWith(
    `https://code.verboo.ai/api/me/groups/${GROUP_ID}/checkout`,
    expect.objectContaining({
      paymentMethod: 'woovi',
      requestId: expect.any(String),
      purchaseIntent: 'new',
      woovi: { taxId: '52998224725', phone: '11999999999' },
    }),
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer access-token',
      }),
    }),
  )
})

test('paid entitlement never treats an active trial as a completed purchase', () => {
  const trial = {
    id: SUBSCRIPTION_ID,
    groupId: GROUP_ID,
    source: 'stripe_trial',
    status: 'trialing',
    cancelAtPeriodEnd: false,
  }
  expect(hasGroupSubscriptionEntitlement([trial], GROUP_ID, 'access')).toBe(true)
  expect(hasGroupSubscriptionEntitlement([trial], GROUP_ID, 'paid')).toBe(false)
  expect(
    hasGroupSubscriptionEntitlement(
      [{ ...trial, source: 'stripe', status: 'active' }],
      GROUP_ID,
      'paid',
    ),
  ).toBe(true)
  expect(
    hasGroupSubscriptionEntitlement(
      [{ ...trial, source: 'stripe_trial', status: 'active' }],
      GROUP_ID,
      'paid',
    ),
  ).toBe(true)
  expect(
    hasGroupSubscriptionEntitlement(
      [{ ...trial, source: 'woovi', status: 'active' }],
      GROUP_ID,
      'paid',
    ),
  ).toBe(true)
  expect(
    hasGroupSubscriptionEntitlement(
      [{ ...trial, source: 'manual', status: 'active' }],
      GROUP_ID,
      'paid',
    ),
  ).toBe(false)
})

test('confirms only the Woovi subscription that became active', async () => {
  const get = mock(async () => ({
    data: {
      data: [
        {
          id: SUBSCRIPTION_ID,
          groupId: OTHER_GROUP_ID,
          wooviSubscriptionId: 'other',
          status: 'active',
          cancelAtPeriodEnd: false,
        },
        {
          id: SUBSCRIPTION_ID,
          groupId: GROUP_ID,
          wooviSubscriptionId: 'expected',
          status: 'incomplete',
          cancelAtPeriodEnd: false,
        },
      ],
    },
  }))
  axios.get = get as typeof axios.get

  await expect(
    isWooviSubscriptionActive('access-token', 'expected'),
  ).resolves.toBe(false)

  get.mockResolvedValueOnce({
    data: {
      data: [
        {
          id: SUBSCRIPTION_ID,
          groupId: GROUP_ID,
          wooviSubscriptionId: 'expected',
          status: 'active',
          cancelAtPeriodEnd: false,
        },
      ],
    },
  })
  await expect(
    isWooviSubscriptionActive('access-token', 'expected'),
  ).resolves.toBe(true)
})

test('starts a cardless trial with an international WhatsApp number', async () => {
  const post = mock(async () => ({
    data: {
      data: {
        mode: 'verification_required',
        verificationId: VERIFICATION_ID,
        maskedPhone: '+55 ••••••1234',
        expiresAt: '2026-07-19T12:00:00Z',
        resendAt: '2026-07-19T11:55:00Z',
        attemptsRemaining: 5,
      },
    },
  }))
  axios.post = post as typeof axios.post

  await expect(
    startCardlessTrial('access-token', GROUP_ID, {
      useVerifiedPhone: false,
      phone: '+5585999991234',
      countryCode: 'BR',
    }),
  ).resolves.toEqual({
    mode: 'verification_required',
    verificationId: VERIFICATION_ID,
    maskedPhone: '+55 ••••••1234',
    expiresAt: '2026-07-19T12:00:00Z',
    resendAt: '2026-07-19T11:55:00Z',
    attemptsRemaining: 5,
  })

  expect(post).toHaveBeenCalledWith(
    `https://code.verboo.ai/api/me/groups/${GROUP_ID}/cardless-trial`,
    {
      useVerifiedPhone: false,
      phone: '+5585999991234',
      countryCode: 'BR',
    },
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer access-token',
      }),
    }),
  )
})

test('loads a verified profile and confirms its six-digit code', async () => {
  const get = mock(async () => ({
    data: {
      data: {
        verified: true,
        maskedPhone: '+55 ••••••1234',
        countryCode: 'BR',
      },
    },
  }))
  const post = mock(async () => ({
    data: {
      data: { mode: 'trial_activated', groupId: GROUP_ID, status: 'trialing' },
    },
  }))
  axios.get = get as typeof axios.get
  axios.post = post as typeof axios.post

  await expect(getWhatsAppProfile('access-token')).resolves.toMatchObject({
    verified: true,
    countryCode: 'BR',
  })
  await expect(
    confirmCardlessTrial('access-token', VERIFICATION_ID, '123456'),
  ).resolves.toMatchObject({
    mode: 'trial_activated',
    status: 'trialing',
  })
  expect(post).toHaveBeenCalledWith(
    `https://code.verboo.ai/api/me/cardless-trial-verifications/${VERIFICATION_ID}/confirm`,
    { code: '123456' },
    expect.anything(),
  )
})

test('preserves backend error code, status, and retry-after', async () => {
  axios.post = mock(async () => {
    throw {
      isAxiosError: true,
      response: {
        status: 429,
        data: { error: 'too many attempts', code: 'rate_limited' },
        headers: { 'retry-after': '7' },
      },
    }
  }) as typeof axios.post

  await expect(
    confirmCardlessTrial('access-token', VERIFICATION_ID, '123456'),
  ).rejects.toMatchObject({
    status: 429,
    code: 'rate_limited',
    retryAfterSeconds: 7,
  })
})

test('rejects a malformed Woovi checkout response', async () => {
  axios.post = mock(async () => ({
    data: { data: { mode: 'woovi', wooviQrCode: '' } },
  })) as typeof axios.post

  await expect(
    createCheckoutSession('access-token', GROUP_ID, {
      paymentMethod: 'woovi',
      woovi: { taxId: '52998224725', phone: '11999999999' },
    }),
  ).rejects.toMatchObject({ code: 'contract_error' })
})

test('rejects invalid Woovi payer data before sending a request', async () => {
  const post = mock(async () => ({ data: { data: { mode: 'reactivated' } } }))
  axios.post = post as typeof axios.post

  await expect(
    createCheckoutSession('access-token', GROUP_ID, {
      paymentMethod: 'woovi',
      woovi: { taxId: '52998224724', phone: '11999999999' },
    }),
  ).rejects.toMatchObject({ code: 'invalid_request' })
  expect(post).not.toHaveBeenCalled()
})

test('the exact purchase attempt confirms payment, never an existing group membership',async()=>{
 const {isPurchaseAttemptSucceeded}=await import('./verbooCheckout.js')
 const get=mock(async()=>({data:{data:{id:ATTEMPT_ID,groupId:GROUP_ID,status:'pending'}}}))
 axios.get=get as typeof axios.get
 expect(await isPurchaseAttemptSucceeded('token',ATTEMPT_ID,GROUP_ID)).toBe(false)
 get.mockResolvedValueOnce({data:{data:{id:ATTEMPT_ID,groupId:GROUP_ID,status:'succeeded'}}})
 expect(await isPurchaseAttemptSucceeded('token',ATTEMPT_ID,GROUP_ID)).toBe(true)
 get.mockResolvedValueOnce({data:{data:{id:ATTEMPT_ID,groupId:OTHER_GROUP_ID,status:'succeeded'}}})
 await expect(isPurchaseAttemptSucceeded('token',ATTEMPT_ID,GROUP_ID)).rejects.toMatchObject({kind:'contract'})
 expect(get.mock.calls.every(call=>String(call[0]).endsWith('/purchase-attempts/'+ATTEMPT_ID))).toBe(true)
})

test('terminal attempts stop polling without inferring access',async()=>{
 const {isPurchaseAttemptSucceeded}=await import('./verbooCheckout.js')
 for (const status of ['failed','expired','review']) {
  axios.get=(async()=>({data:{data:{id:ATTEMPT_ID,groupId:GROUP_ID,status}}})) as typeof axios.get
  await expect(isPurchaseAttemptSucceeded('token',ATTEMPT_ID,GROUP_ID)).rejects.toMatchObject({code:`purchase_attempt_${status}`})
 }
})
test('manual retry preserves request and journey across token refresh for the same actor',async()=>{
 const requests: unknown[][]=[]
 axios.post=(async(...args:unknown[])=>{requests.push(args);return {data:{data:{mode:'stripe',attemptId:ATTEMPT_ID,url:'https://checkout.stripe.com/original'}}}}) as typeof axios.post
 const jwt=(sub:string,version:number)=>'header.'+Buffer.from(JSON.stringify({sub,version})).toString('base64url')+'.signature'
 await createCheckoutSession(jwt(GROUP_ID,1),GROUP_ID,{paymentMethod:'stripe',billingInterval:'month'})
 await createCheckoutSession(jwt(GROUP_ID,2),GROUP_ID,{paymentMethod:'stripe',billingInterval:'month'})
 expect(requests[0][1]).toEqual(requests[1][1])
 expect((requests[0][2] as {headers:Record<string,string>}).headers['X-Verboo-Journey-Id']).toBe((requests[1][2] as {headers:Record<string,string>}).headers['X-Verboo-Journey-Id'])
 await createCheckoutSession(jwt(OTHER_GROUP_ID,1),GROUP_ID,{paymentMethod:'stripe',billingInterval:'month'})
 expect((requests[2][1] as {requestId:string}).requestId).not.toBe((requests[0][1] as {requestId:string}).requestId)
})


test('a different account cannot reuse the previous purchase observation identity', async()=>{
 const {isPurchaseAttemptSucceeded}=await import('./verbooCheckout.js')
 const headers: Record<string,string>[]=[]
 axios.get=(async(_url, config)=>{headers.push(config.headers); return {data:{data:{id:ATTEMPT_ID,groupId:GROUP_ID,status:'pending'}}}}) as typeof axios.get
 const jwt=(sub:string,version:number)=>'header.'+Buffer.from(JSON.stringify({sub,version})).toString('base64url')+'.signature'
 await isPurchaseAttemptSucceeded(jwt(GROUP_ID,1),ATTEMPT_ID,GROUP_ID)
 await isPurchaseAttemptSucceeded(jwt(GROUP_ID,2),ATTEMPT_ID,GROUP_ID)
 await isPurchaseAttemptSucceeded(jwt(OTHER_GROUP_ID,1),ATTEMPT_ID,GROUP_ID)
 for (const key of ['X-Verboo-Journey-Id','X-Verboo-Operation-Id']) {
  expect(headers[0][key]).toBe(headers[1][key])
  expect(headers[2][key]).not.toBe(headers[0][key])
 }
})
