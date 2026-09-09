import { PassThrough } from 'node:stream'

import { afterEach, expect, mock, test } from 'bun:test'
import axios from 'axios'
import React from 'react'
import stripAnsi from 'strip-ansi'

import { render } from '../../ink.js'
import {
  PurchaseFlowView,
  StandalonePurchaseFlowView,
  WooviPaymentView,
} from './purchaseFlow.js'

const originalGet = axios.get

afterEach(() => {
  axios.get = originalGet
})

test('prints both the Pix QR and the exact copy-and-paste payload in the terminal', async () => {
  const qrCode =
    '00020101021226850014br.gov.bcb.pix2563pix.example/checkout/123456789'
  axios.get = mock(async () => ({
    data: {
      data: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          groupId: '22222222-2222-4222-8222-222222222222',
          status: 'incomplete',
          wooviSubscriptionId: 'woovi-subscription',
          cancelAtPeriodEnd: false,
        },
      ],
    },
  })) as typeof axios.get

  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = 120
  stdout.on('data', (chunk) => {
    output += chunk.toString()
  })

  const instance = await render(
    <WooviPaymentView
      accessToken="access-token"
      qrCode={qrCode}
      subscriptionId="woovi-subscription"
      onCancel={() => {}}
      onConfirmed={() => {}}
      onError={() => {}}
    />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    },
  )

  try {
    const startedAt = Date.now()
    while (Date.now() - startedAt < 1_500) {
      const rendered = stripAnsi(output)
      if (rendered.includes(qrCode) && /[▀▄█]/.test(rendered)) break
      await Bun.sleep(20)
    }
    const rendered = stripAnsi(output)
    expect(rendered).toContain('Pix copia e cola:')
    expect(rendered).toContain(qrCode)
    expect(rendered).toMatch(/[▀▄█]/)
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})

test('navigates from the standalone selector through the plan grid with arrow keys', async () => {
  const marketplacePlan = (id: string, name: string, modelName: string) => ({
    id,
    name,
    slug: name.toLowerCase().replaceAll(' ', '-'),
    priceCents: 1_000,
    currency: 'brl',
    billingInterval: 'month',
    instances: [{ models: [{ modelName }] }],
    memberCount: 0,
    subscriberLimit: null,
    trialDays: 7,
    trialPaymentMethodRequired: false,
    trialEligible: false,
    paymentProvider: 'stripe',
    apiOnly: false,
    isMember: false,
    isOnWaitlist: false,
    waitlistEnabled: false,
    waitlistSubscribersOnly: false,
  })
  axios.get = mock(async (url: string) => {
    if (url.endsWith('/api/marketplace')) {
      return {
        data: {
          data: [
            marketplacePlan(
              '11111111-1111-4111-8111-111111111111',
              'Plano Um',
              'model-one',
            ),
            marketplacePlan(
              '22222222-2222-4222-8222-222222222222',
              'Plano Dois',
              'model-two',
            ),
          ],
        },
      }
    }
    return { data: { data: [] } }
  }) as typeof axios.get

  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = 120
  stdout.on('data', (chunk) => {
    output += chunk.toString()
  })

  const instance = await render(
    <PurchaseFlowView accessToken="access-token" onDone={() => {}} />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    },
  )

  try {
    await Bun.sleep(30)
    stdin.write('\x1B[B')
    await Bun.sleep(20)
    stdin.write('\r')

    const catalogStartedAt = Date.now()
    while (
      Date.now() - catalogStartedAt < 1_500 &&
      !stripAnsi(output).includes('Planos disponíveis')
    ) {
      await Bun.sleep(20)
    }

    // A committed frame precedes registration of the grid input effect.
    await Bun.sleep(30)
    stdin.write('\x1B[C')
    await Bun.sleep(20)
    stdin.write('\r')

    const detailStartedAt = Date.now()
    while (
      Date.now() - detailStartedAt < 1_500 &&
      !stripAnsi(output).includes('Modelos: model-two')
    ) {
      await Bun.sleep(20)
    }
    const rendered = stripAnsi(output)
    expect(rendered).toContain('Modelos: model-two')
    expect(rendered).toContain('Assinar agora')
    expect(rendered).not.toContain('Testar grátis')
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})

test('renders the Pix payer input inside the standalone provider tree', async () => {
  axios.get = mock(async (url: string) => {
    if (url.endsWith('/api/marketplace')) {
      return {
        data: {
          data: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              name: 'Plano Pix',
              slug: 'plano-pix',
              priceCents: 1_000,
              currency: 'brl',
              billingInterval: 'month',
              instances: [{ models: [{ modelName: 'model-pix' }] }],
              memberCount: 0,
              subscriberLimit: null,
              trialDays: null,
              trialPaymentMethodRequired: false,
              trialEligible: false,
              paymentProvider: 'woovi',
              apiOnly: false,
              isMember: false,
              isOnWaitlist: false,
              waitlistEnabled: false,
              waitlistSubscribersOnly: false,
            },
          ],
        },
      }
    }
    return { data: { data: [] } }
  }) as typeof axios.get

  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = 120
  stdout.on('data', (chunk) => {
    output += chunk.toString()
  })

  const instance = await render(
    <StandalonePurchaseFlowView accessToken="access-token" onDone={() => {}} />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    },
  )

  try {
    await Bun.sleep(30)
    stdin.write('\x1B[B')
    stdin.write('\r')

    const catalogStartedAt = Date.now()
    while (
      Date.now() - catalogStartedAt < 1_500 &&
      !stripAnsi(output).includes('Planos disponíveis')
    ) {
      await Bun.sleep(20)
    }

    stdin.write('\r')
    const detailStartedAt = Date.now()
    while (
      Date.now() - detailStartedAt < 1_500 &&
      !stripAnsi(output).includes('Modelos: model-pix')
    ) {
      await Bun.sleep(20)
    }

    await Bun.sleep(50)
    stdin.write('\r')
    await Bun.sleep(50)
    if (!stripAnsi(output).includes('Dados para o Pix Automático')) {
      stdin.write('\r')
    }
    const payerStartedAt = Date.now()
    while (
      Date.now() - payerStartedAt < 1_500 &&
      !stripAnsi(output).includes('Dados para o Pix Automático')
    ) {
      await Bun.sleep(20)
    }

    const rendered = stripAnsi(output)
    expect(rendered).toContain('Dados para o Pix Automático')
    expect(rendered).toContain('CPF')

    stdin.write('52998224725')
    await Bun.sleep(50)
    stdin.write('\r')

    const phoneStartedAt = Date.now()
    while (
      Date.now() - phoneStartedAt < 1_500 &&
      !stripAnsi(output).includes('Celular com DDD')
    ) {
      await Bun.sleep(20)
    }

    const phoneRendered = stripAnsi(output)
    expect(phoneRendered).toContain('52998224725')
    expect(phoneRendered).not.toContain('529.982.247-25')
    expect(phoneRendered).toContain('Celular com DDD')

    stdin.write('11999999999')
    await Bun.sleep(50)
    const completedPhoneRendered = stripAnsi(output)
    expect(completedPhoneRendered).toContain('11999999999')
    expect(completedPhoneRendered).not.toContain('(11) 99999-9999')
  } finally {
    instance.unmount()
    stdin.end()
    stdout.end()
  }
})
