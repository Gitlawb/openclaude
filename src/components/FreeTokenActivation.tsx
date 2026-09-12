import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text, render } from '../ink.js'
import { Select } from './CustomSelect/select.js'
import { openBrowser } from '../utils/browser.js'
import { FreeTokenAccountingNotice } from './FreeTokenAccountingNotice.js'
import { activateFreeTokens, fetchFreeTokenQuote, fetchFreeTokenStatus, type FreeTokenQuote, type FreeTokenStatus } from '../services/api/verbooFreeTokens.js'

const defaultDependencies = { activateFreeTokens, fetchFreeTokenQuote, fetchFreeTokenStatus, openBrowser }
type FreeTokenActivationDependencies = typeof defaultDependencies

export function FreeTokenActivationView({ onDone, dependencies = defaultDependencies }: {
  onDone: (activated: boolean) => void
  dependencies?: FreeTokenActivationDependencies
}) {
  const [status, setStatus] = useState<FreeTokenStatus | null>(null)
  const [quote, setQuote] = useState<FreeTokenQuote | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const done = useRef(onDone); done.current = onDone
  const accepting = useRef(false)
  const refresh = useCallback(async () => {
    const signal = controller.current?.signal
    const current = await dependencies.fetchFreeTokenStatus(signal)
    if (signal?.aborted) return
    setStatus(current)
    if (current.state === 'converted' || (current.state === 'active' && current.tokensRemaining > 0 && !(current.accountingBlocked ?? current.accountingPending))) { done.current(true); return }
    if (current.state === 'active' || current.state === 'exhausted') {
      const next = await dependencies.fetchFreeTokenQuote(signal)
      if (!signal?.aborted) setQuote(next)
    } else setQuote(null)
  }, [dependencies])
  useEffect(() => {
    controller.current = new AbortController()
    void refresh().catch(() => { if (!controller.current?.signal.aborted) setError(true) })
    return () => controller.current?.abort()
  }, [refresh])
  useEffect(() => {
    if (status?.state !== 'activating' && status?.state !== 'checkout_required') return
    const timer = setInterval(() => { void refresh().catch(() => setError(true)) }, 3_000)
    return () => clearInterval(timer)
  }, [status?.state, refresh])
  const accept = async () => {
    if (!quote || accepting.current) return
    accepting.current = true; setBusy(true); setError(false)
    try {
      const result = await dependencies.activateFreeTokens(quote.token, controller.current?.signal)
      setQuote(null); setStatus(result)
      if (result.state === 'converted') done.current(true)
      else if (result.state === 'checkout_required' && result.checkoutUrl) await dependencies.openBrowser(result.checkoutUrl)
    } catch { setError(true); await refresh().catch(() => {}) }
    finally { accepting.current = false; setBusy(false) }
  }
  const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: quote!.currency }).format(cents / 100)
  return <Box flexDirection="column" gap={1} borderStyle="round" paddingX={1}>
    <Text bold>Ativação do plano</Text>
    {status?.state === 'exhausted' && <Text>Seus tokens grátis acabaram e a inferência foi pausada. Para continuar a conversa, ative o plano com o cartão já cadastrado. A cobrança só acontece após o seu aceite.</Text>}
    {status && <FreeTokenAccountingNotice status={status} />}
    {(status?.accountingBlocked ?? status?.accountingPending) && <Text>Você pode ativar o plano pago enquanto confirmamos o consumo gratuito. A cobrança só acontece após o seu aceite.</Text>}
    {status && <Text>{status.tokensRemaining.toLocaleString('pt-BR')} tokens restantes · {status.tokensUsed.toLocaleString('pt-BR')} consumidos</Text>}
    {error && <Text color="yellow">Não foi possível confirmar a operação. Verifique novamente; uma tentativa pode estar em andamento.</Text>}
    {quote && !busy && <>
      <Text>{quote.groupName}: {money(quote.amountCents)} agora no cartão cadastrado. Renovação por {money(quote.renewalAmountCents)}/{quote.billingInterval === 'year' ? 'ano' : 'mês'} até cancelar.</Text>
      <Select options={[
        { label: `Ativar plano e pagar ${money(quote.amountCents)}`, description: 'Usar o cartão cadastrado e continuar a conversa.', value: 'accept' },
        { label: 'Agora não', description: 'Manter a inferência pausada sem ativar o plano.', value: 'later' },
      ]} onChange={value => { if (value === 'accept') void accept(); else onDone(false) }} onCancel={() => onDone(false)} />
    </>}
    {(busy || status?.state === 'activating') && <Text>Confirmando ativação…</Text>}
    {status?.state === 'checkout_required' && status.checkoutUrl && <>
      <Text>O cartão precisa de outra ação. Conclua na Stripe: {status.checkoutUrl}</Text>
      <Select options={[{ label: 'Abrir Stripe', value: 'open' }, { label: 'Agora não', value: 'later' }]} onChange={value => { if (value === 'open') void dependencies.openBrowser(status.checkoutUrl!); else onDone(false) }} onCancel={() => onDone(false)} />
    </>}
    {!quote && status?.state !== 'checkout_required' && !busy && <>
      {status && ['eligible', 'pending_setup', 'unavailable'].includes(status.state) && <Text>Cadastre seu cartão ou escolha um plano: {status.activationUrl}</Text>}
      <Select options={[{ label: 'Verificar novamente', value: 'retry' }, { label: 'Agora não', value: 'later' }]} onChange={value => { if (value === 'retry') void refresh().catch(() => setError(true)); else onDone(false) }} onCancel={() => onDone(false)} />
    </>}
  </Box>
}

export async function showFreeTokenActivation(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let instance: { unmount: () => void } | undefined
    let result: boolean | undefined
    const finish = (value: boolean) => {
      result = value
      if (instance) { instance.unmount(); resolve(value) }
    }
    void render(<FreeTokenActivationView onDone={finish} />).then(value => {
      instance = value
      if (result !== undefined) finish(result)
    }, reject)
  })
}
