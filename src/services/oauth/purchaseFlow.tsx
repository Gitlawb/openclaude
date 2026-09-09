import { setupFreeTokens } from '../api/verbooFreeTokens.js'
import { toString as qrToString } from 'qrcode'
import React, { useCallback, useState } from 'react'
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js'

import { Select } from '../../components/CustomSelect/select.js'
import { Spinner } from '../../components/Spinner.js'
import TextInput from '../../components/TextInput.js'
import { VERBOO_FRONT_BASE_URL } from '../../constants/oauth.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, render, Text, useInput } from '../../ink.js'
import { AppStateProvider } from '../../state/AppState.js'
import { openBrowser } from '../../utils/browser.js'
import {
  createCheckoutSession,
  confirmCardlessTrial,
  getWhatsAppProfile,
  isGroupSubscriptionActive,
  isWooviSubscriptionActive,
  resendCardlessTrialCode,
  startCardlessTrial,
  type CardlessTrialResult,
  type GroupEntitlementRequirement,
  type PaymentMethod,
  type WhatsAppProfile,
  type WooviCheckoutData,
} from '../api/verbooCheckout.js'
import { VerbooApiError } from '../api/verbooApiError.js'
import {
  fetchMarketplaceGroups,
  type MarketplaceGroup,
} from '../api/verbooMarketplace.js'
import {
  fetchSubscriptions,
  type SubscriptionResponse,
} from '../api/verbooSubscriptions.js'
import { describePurchaseError } from './purchaseErrors.js'
import { isValidCPF, onlyDigits } from './purchaseValidation.js'

const POLL_INTERVAL_MS = 3_000
const POLL_TIMEOUT_MS = 5 * 60 * 1_000
const INPUT_COLUMNS = 48

type Direction = 'left' | 'right' | 'up' | 'down'

export function getPlanColumnCount(terminalColumns: number): number {
  if (terminalColumns < 72) return 1
  if (terminalColumns < 112) return 2
  return 3
}

export function movePlanFocus(
  index: number,
  direction: Direction,
  count: number,
  columns: number,
): number {
  if (count <= 0) return 0
  const safeIndex = Math.min(Math.max(index, 0), count - 1)
  const column = safeIndex % columns
  if (direction === 'left') return column === 0 ? safeIndex : safeIndex - 1
  if (direction === 'right') {
    return column === columns - 1 || safeIndex + 1 >= count
      ? safeIndex
      : safeIndex + 1
  }
  if (direction === 'up') {
    return safeIndex - columns >= 0 ? safeIndex - columns : safeIndex
  }
  return safeIndex + columns < count ? safeIndex + columns : safeIndex
}

function isCurrentLocalTrial(subscription?: SubscriptionResponse): boolean {
  return (
    subscription?.status === 'trialing' &&
    ['trial', 'stripe_trial'].includes(subscription.source ?? '')
  )
}

export function getStripeTrialConversionUrl(
  subscriptionId: string,
  billingInterval: 'month' | 'year',
): string {
  return `${VERBOO_FRONT_BASE_URL}/pt/settings/billing?subscription=${encodeURIComponent(subscriptionId)}&action=convert&billingInterval=${encodeURIComponent(billingInterval)}`
}

export function filterCliPurchasablePlans(
  groups: MarketplaceGroup[],
  subscriptions: SubscriptionResponse[],
): MarketplaceGroup[] {
  const subscriptionsByGroup = new Map(
    subscriptions
      .filter((subscription) =>
        ['active', 'trialing', 'past_due'].includes(subscription.status),
      )
      .map((subscription) => [subscription.groupId, subscription]),
  )

  return groups.filter((group) => {
    if (group.apiOnly || getModelNames(group) === '') return false
    if (group.waitlistEnabled) return false
    if (group.waitlistSubscribersOnly && !group.isOnWaitlist) return false

    const subscription = subscriptionsByGroup.get(group.id)
    const convertingLocalTrial = isCurrentLocalTrial(subscription)
    if (subscription?.status === 'past_due') return false
    if ((group.isMember || subscription) && !convertingLocalTrial) return false

    const full =
      group.subscriberLimit != null &&
      (group.memberCount ?? 0) >= group.subscriberLimit
    return !full || convertingLocalTrial
  })
}

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

function formatInterval(interval: string): string {
  return interval === 'year' ? '/ano' : '/mês'
}

function getModelNames(group: MarketplaceGroup): string {
  const names = new Set<string>()
  for (const instance of group.instances) {
    for (const model of instance.models) names.add(model.modelName)
  }
  return [...names].join(', ')
}

function getSlotsInfo(group: MarketplaceGroup): string {
  const current = group.memberCount ?? 0
  if (group.subscriberLimit != null) {
    const remaining = group.subscriberLimit - current
    if (remaining <= 0) return 'Grupo lotado'
    return `${current}/${group.subscriberLimit} assinantes`
  }
  return `${current} assinantes`
}

function paymentProviderLabel(group: MarketplaceGroup): string {
  switch (group.paymentProvider) {
    case 'woovi':
      return 'Pix Automático'
    case 'both':
      return 'Cartão ou Pix'
    default:
      return 'Cartão'
  }
}

function hasCardlessTrial(group: MarketplaceGroup): boolean {
  return Boolean(
    group.trialEligible &&
    group.trialDays &&
    group.billingInterval === 'month' &&
    group.trialPaymentMethodRequired === false &&
    group.paymentProvider !== 'woovi',
  )
}

function hasCardTrial(group: MarketplaceGroup): boolean {
  return Boolean(
    group.trialEligible &&
    group.trialDays &&
    group.billingInterval === 'month' &&
    group.trialPaymentMethodRequired !== false &&
    group.paymentProvider !== 'woovi',
  )
}

export function getPlanDetailOptions(
  plan: MarketplaceGroup,
): Array<{ label: string; value: string }> {
  if ((plan.freeTokens ?? 0) > 0 && plan.freeTokensEligible !== false) {
    return [{ label: `Usar ${plan.freeTokens!.toLocaleString('pt-BR')} tokens grátis — cartão sem cobrança`, value: 'free-tokens' }, { label: 'Voltar', value: 'back' }]
  }
  if (hasCardlessTrial(plan)) {
    return [
      { label: `Testar grátis por ${plan.trialDays} dias`, value: 'trial' },
      { label: 'Assinar agora', value: 'buy' },
      { label: 'Voltar', value: 'back' },
    ]
  }
  if (hasCardTrial(plan)) {
    return [
      {
        label: `Testar ${plan.trialDays} dias com cartão`,
        value: 'card-trial',
      },
      ...(plan.paymentProvider === 'both'
        ? [{ label: 'Assinar agora com Pix', value: 'pix' }]
        : []),
      { label: 'Voltar', value: 'back' },
    ]
  }
  return [
    { label: 'Assinar agora', value: 'buy' },
    { label: 'Voltar', value: 'back' },
  ]
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

type CardlessPhoneFormProps = {
  initialCountry?: string
  onCancel: () => void
  onSubmit: (phone: string, country: CountryCode) => void
}

function CardlessPhoneForm({
  initialCountry,
  onCancel,
  onSubmit,
}: CardlessPhoneFormProps): React.ReactNode {
  const initial = getCountries().includes(initialCountry as CountryCode)
    ? (initialCountry as CountryCode)
    : 'BR'
  const [country, setCountry] = useState<CountryCode>(initial)
  const [choosingCountry, setChoosingCountry] = useState(true)
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cursorOffset, setCursorOffset] = useState(0)
  const names = React.useMemo(
    () => new Intl.DisplayNames(['pt-BR'], { type: 'region' }),
    [],
  )
  const countries = React.useMemo(
    () =>
      getCountries()
        .map((value) => ({
          value,
          label: `${names.of(value) ?? value} (+${getCountryCallingCode(value)})`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    [names],
  )

  if (choosingCountry) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>País do WhatsApp</Text>
        <Select
          options={countries}
          defaultFocusValue={country}
          visibleOptionCount={8}
          onCancel={onCancel}
          onChange={(value: CountryCode) => {
            setCountry(value)
            setChoosingCountry(false)
          }}
        />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Confirme seu WhatsApp para iniciar o teste sem cartão</Text>
      <Text dimColor>
        {names.of(country)} (+{getCountryCallingCode(country)})
      </Text>
      <TextInput
        value={phone}
        cursorOffset={cursorOffset}
        onChangeCursorOffset={setCursorOffset}
        onChange={(value) => {
          setPhone(value)
          setError(null)
        }}
        onSubmit={(value) => {
          const parsed = parsePhoneNumberFromString(value, country)
          if (!parsed?.isValid()) {
            setError('Informe um número de WhatsApp válido.')
            return
          }
          onSubmit(parsed.number, country)
        }}
        onExit={() => setChoosingCountry(true)}
        columns={INPUT_COLUMNS}
        placeholder="Número com DDD"
        focus
        showCursor
        multiline={false}
      />
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>Enter para enviar o código · Esc para trocar o país</Text>
    </Box>
  )
}

type VerificationRequired = Extract<
  CardlessTrialResult,
  { mode: 'verification_required' }
>

function CardlessCodeForm({
  verification,
  onConfirm,
  onResend,
}: {
  verification: VerificationRequired
  onConfirm: (code: string) => void
  onResend: () => void
}): React.ReactNode {
  const [code, setCode] = useState('')
  const [actions, setActions] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursorOffset, setCursorOffset] = useState(0)

  if (actions) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Opções da verificação</Text>
        <Select
          options={[
            { label: 'Digitar o código', value: 'code' },
            { label: 'Reenviar código', value: 'resend' },
          ]}
          onCancel={() => setActions(false)}
          onChange={(value: string) => {
            if (value === 'resend') onResend()
            else setActions(false)
          }}
        />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Código de verificação</Text>
      <Text dimColor>Enviamos 6 dígitos para {verification.maskedPhone}.</Text>
      <Text dimColor>
        Tentativas restantes: {verification.attemptsRemaining}
      </Text>
      <TextInput
        value={code}
        cursorOffset={cursorOffset}
        onChangeCursorOffset={setCursorOffset}
        onChange={(value) => {
          setCode(onlyDigits(value).slice(0, 6))
          setError(null)
        }}
        onSubmit={(value) => {
          const normalized = onlyDigits(value)
          if (normalized.length !== 6) {
            setError('Digite os 6 dígitos do código.')
            return
          }
          onConfirm(normalized)
        }}
        onExit={() => setActions(true)}
        columns={INPUT_COLUMNS}
        placeholder="123456"
        focus
        showCursor
        multiline={false}
      />
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>Enter para confirmar · Esc para ver opções</Text>
    </Box>
  )
}

function WooviPayerForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void
  onSubmit: (data: WooviCheckoutData) => void
}): React.ReactNode {
  const [field, setField] = useState<'cpf' | 'phone'>('cpf')
  const [cpf, setCPF] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cpfCursorOffset, setCPFCursorOffset] = useState(0)
  const [phoneCursorOffset, setPhoneCursorOffset] = useState(0)

  const submitCPF = (value: string) => {
    const digits = onlyDigits(value).slice(0, 11)
    setCPF(digits)
    if (!isValidCPF(digits)) {
      setError('Informe um CPF válido para continuar.')
      return
    }
    setError(null)
    setField('phone')
  }

  const submitPhone = (value: string) => {
    const digits = onlyDigits(value).slice(0, 11)
    setPhone(digits)
    if (digits.length !== 11 || digits[2] !== '9') {
      setError('Informe um celular brasileiro com DDD.')
      return
    }
    onSubmit({ taxId: onlyDigits(cpf), phone: digits })
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Dados para o Pix Automático</Text>
      <Text dimColor>
        A Woovi precisa destes dados para criar a recorrência. Eles não são
        salvos no seu computador.
      </Text>
      {field === 'cpf' ? (
        <Box flexDirection="column">
          <Text>CPF</Text>
          <TextInput
            value={cpf}
            cursorOffset={cpfCursorOffset}
            onChangeCursorOffset={setCPFCursorOffset}
            onChange={(value) => {
              setError(null)
              setCPF(onlyDigits(value).slice(0, 11))
            }}
            onSubmit={submitCPF}
            onExit={onCancel}
            columns={INPUT_COLUMNS}
            placeholder="00000000000"
            focus
            showCursor
            multiline={false}
          />
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text>Celular com DDD</Text>
          <TextInput
            value={phone}
            cursorOffset={phoneCursorOffset}
            onChangeCursorOffset={setPhoneCursorOffset}
            onChange={(value) => {
              setError(null)
              setPhone(onlyDigits(value).slice(0, 11))
            }}
            onSubmit={submitPhone}
            onExit={onCancel}
            columns={INPUT_COLUMNS}
            placeholder="11999999999"
            focus
            showCursor
            multiline={false}
          />
        </Box>
      )}
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>Enter para continuar · Esc para voltar</Text>
    </Box>
  )
}

export function WooviPaymentView({
  accessToken,
  qrCode,
  subscriptionId,
  onCancel,
  onConfirmed,
  onError,
}: {
  accessToken: string
  qrCode: string
  subscriptionId: string
  onCancel: () => void
  onConfirmed: () => void
  onError: (error: unknown) => void
}): React.ReactNode {
  const [qr, setQR] = useState('')
  const [qrFailed, setQRFailed] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [attempt, setAttempt] = useState(0)

  React.useEffect(() => {
    let cancelled = false
    setQR('')
    setQRFailed(false)
    qrToString(qrCode, {
      type: 'utf8',
      errorCorrectionLevel: 'M',
      small: true,
    })
      .then((value) => {
        if (!cancelled) setQR(value)
      })
      .catch(() => {
        if (!cancelled) setQRFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [qrCode])

  React.useEffect(() => {
    const controller = new AbortController()
    const start = Date.now()
    setTimedOut(false)

    const poll = async () => {
      while (
        !controller.signal.aborted &&
        Date.now() - start < POLL_TIMEOUT_MS
      ) {
        try {
          if (
            await isWooviSubscriptionActive(accessToken, subscriptionId, {
              signal: controller.signal,
            })
          ) {
            onConfirmed()
            return
          }
        } catch (error) {
          if (controller.signal.aborted) return
          if (
            error instanceof VerbooApiError &&
            (error.status === 401 ||
              error.status === 403 ||
              error.kind === 'contract')
          ) {
            onError(error)
            return
          }
        }
        try {
          await waitFor(POLL_INTERVAL_MS, controller.signal)
        } catch {
          return
        }
      }
      if (!controller.signal.aborted) setTimedOut(true)
    }

    void poll()
    return () => controller.abort()
  }, [accessToken, attempt, onConfirmed, onError, subscriptionId])

  useInput(
    (_input, key) => {
      if (key.escape) onCancel()
    },
    { isActive: !timedOut },
  )

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Escaneie o QR Code para aprovar o Pix Automático</Text>
      {qr ? (
        <Box flexDirection="column">
          {qr
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line, index) => (
              <Text key={index}>{line}</Text>
            ))}
        </Box>
      ) : qrFailed ? (
        <Text color="warning">
          Não foi possível desenhar o QR Code. Use o Pix copia e cola abaixo.
        </Text>
      ) : (
        <Spinner />
      )}
      <Text dimColor>Pix copia e cola:</Text>
      <Text wrap="wrap">{qrCode}</Text>
      {timedOut ? (
        <Box flexDirection="column" gap={1}>
          <Text color="warning">
            Ainda não recebemos a confirmação. O QR continua válido.
          </Text>
          <Select
            options={[
              { label: 'Verificar novamente', value: 'retry' },
              { label: 'Fechar', value: 'close' },
            ]}
            onChange={(value: string) => {
              if (value === 'retry') setAttempt((current) => current + 1)
              else onCancel()
            }}
          />
        </Box>
      ) : (
        <Box>
          <Spinner />
          <Text>Aguardando a aprovação no seu banco…</Text>
        </Box>
      )}
    </Box>
  )
}

type Step =
  | 'splash'
  | 'loading-plans'
  | 'plans'
  | 'plan-detail'
  | 'payment-method'
  | 'woovi-form'
  | 'whatsapp-choice'
  | 'whatsapp-phone'
  | 'whatsapp-code'
  | 'cardless-activating'
  | 'cardless-polling'
  | 'checkout'
  | 'polling'
  | 'manual-browser'
  | 'woovi-qr'
  | 'success'
  | 'error'

type FlowError = {
  message: string
  backStep: Step
  retryLabel?: string
}

export function PurchaseFlowView({
  accessToken,
  onDone,
}: {
  accessToken: string
  onDone: (result: boolean) => void
}) {
  const { columns: terminalColumns } = useTerminalSize()
  const columnCount = getPlanColumnCount(terminalColumns)
  const [step, setStep] = useState<Step>('splash')
  const [plans, setPlans] = useState<MarketplaceGroup[]>([])
  const [subscriptionsByGroup, setSubscriptionsByGroup] = useState<
    Map<string, SubscriptionResponse>
  >(new Map())
  const [selectedPlan, setSelectedPlan] = useState<MarketplaceGroup | null>(
    null,
  )
  const [focusIndex, setFocusIndex] = useState(0)
  const [inlineMessage, setInlineMessage] = useState<string | null>(null)
  const [flowError, setFlowError] = useState<FlowError | null>(null)
  const [wooviPayment, setWooviPayment] = useState<{
    qrCode: string
    subscriptionId: string
  } | null>(null)
  const [manualCheckoutUrl, setManualCheckoutUrl] = useState<string | null>(
    null,
  )
  const [manualEntitlementRequirement, setManualEntitlementRequirement] =
    useState<GroupEntitlementRequirement>('paid')
  const [successRequirement, setSuccessRequirement] =
    useState<GroupEntitlementRequirement>('paid')
  const [whatsappProfile, setWhatsAppProfile] =
    useState<WhatsAppProfile | null>(null)
  const [cardlessVerification, setCardlessVerification] =
    useState<VerificationRequired | null>(null)
  const plansRequestRef = React.useRef<AbortController | null>(null)
  const pollingRef = React.useRef<AbortController | null>(null)
  const successTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const retryRef = React.useRef<(() => void) | null>(null)
  const verificationRetryAtRef = React.useRef(0)

  const verificationWaitSeconds = useCallback(() => {
    const remaining = verificationRetryAtRef.current - Date.now()
    return remaining > 0 ? Math.ceil(remaining / 1_000) : 0
  }, [])

  const showError = useCallback(
    (
      message: string,
      backStep: Step,
      retry?: { label: string; run: () => void },
    ) => {
      retryRef.current = retry?.run ?? null
      setFlowError({ message, backStep, retryLabel: retry?.label })
      setStep('error')
    },
    [],
  )

  const complete = useCallback(
    (requirement: GroupEntitlementRequirement) => {
      setSuccessRequirement(requirement)
      setStep('success')
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
      successTimerRef.current = setTimeout(() => onDone(true), 1_500)
    },
    [onDone],
  )

  React.useEffect(
    () => () => {
      plansRequestRef.current?.abort()
      pollingRef.current?.abort()
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
    },
    [],
  )

  const updateSelectedPlan = useCallback(
    (update: Partial<MarketplaceGroup>) => {
      setSelectedPlan((current) =>
        current ? { ...current, ...update } : current,
      )
      setPlans((current) =>
        current.map((plan) =>
          plan.id === selectedPlan?.id ? { ...plan, ...update } : plan,
        ),
      )
    },
    [selectedPlan?.id],
  )

  const fetchPlans = useCallback(async () => {
    plansRequestRef.current?.abort()
    const controller = new AbortController()
    plansRequestRef.current = controller
    setInlineMessage(null)
    setStep('loading-plans')
    try {
      const [groups, subscriptions] = await Promise.all([
        fetchMarketplaceGroups(accessToken, { signal: controller.signal }),
        fetchSubscriptions(accessToken, { signal: controller.signal }),
      ])
      if (plansRequestRef.current !== controller) return
      const eligible = filterCliPurchasablePlans(groups, subscriptions)
      setSubscriptionsByGroup(
        new Map(
          subscriptions
            .filter((subscription) =>
              ['active', 'trialing', 'past_due'].includes(subscription.status),
            )
            .map((subscription) => [subscription.groupId, subscription]),
        ),
      )
      if (eligible.length === 0) {
        const message =
          groups.length === 0
            ? 'Nenhum plano está disponível no momento.'
            : 'Não há novos planos compatíveis com a CLI para esta conta.'
        showError(message, 'splash', {
          label: 'Atualizar catálogo',
          run: () => void fetchPlans(),
        })
        return
      }
      setPlans(eligible)
      setFocusIndex(0)
      setStep('plans')
    } catch (error) {
      if (controller.signal.aborted || plansRequestRef.current !== controller)
        return
      const presentation = describePurchaseError(
        error,
        'Não foi possível carregar os planos.',
      )
      showError(presentation.message, 'splash', {
        label: 'Tentar carregar novamente',
        run: () => void fetchPlans(),
      })
    } finally {
      if (plansRequestRef.current === controller) plansRequestRef.current = null
    }
  }, [accessToken, showError])

  const startEntitlementPolling = useCallback(
    async function pollEntitlement(
      groupId: string,
      displayStep: 'polling' | 'cardless-polling' = 'polling',
      requirement: GroupEntitlementRequirement = 'paid',
    ) {
      pollingRef.current?.abort()
      const controller = new AbortController()
      pollingRef.current = controller
      setStep(displayStep)
      const startedAt = Date.now()

      while (
        !controller.signal.aborted &&
        Date.now() - startedAt < POLL_TIMEOUT_MS
      ) {
        try {
          const active = await isGroupSubscriptionActive(accessToken, groupId, {
            signal: controller.signal,
            requirement,
          })
          if (active) {
            if (pollingRef.current === controller) complete(requirement)
            return
          }
        } catch (error) {
          if (controller.signal.aborted) return
          if (
            error instanceof VerbooApiError &&
            (error.status === 401 ||
              error.status === 403 ||
              error.kind === 'contract')
          ) {
            const presentation = describePurchaseError(
              error,
              'Não foi possível validar a liberação dos modelos.',
            )
            showError(presentation.message, 'plan-detail')
            return
          }
        }

        try {
          await waitFor(POLL_INTERVAL_MS, controller.signal)
        } catch {
          return
        }
      }

      if (pollingRef.current === controller && !controller.signal.aborted) {
        showError(
          'A assinatura foi iniciada, mas os modelos ainda não foram liberados.',
          'plan-detail',
          {
            label: 'Verificar novamente',
            run: () => void pollEntitlement(groupId, displayStep, requirement),
          },
        )
      }
    },
    [accessToken, complete, showError],
  )

  const prepareCardlessTrial = useCallback(
    async function prepare(group: MarketplaceGroup) {
      setSelectedPlan(group)
      setInlineMessage(null)
      setStep('cardless-activating')
      try {
        setWhatsAppProfile(await getWhatsAppProfile(accessToken))
        setStep('whatsapp-choice')
      } catch (error) {
        const presentation = describePurchaseError(
          error,
          'Não foi possível consultar seu WhatsApp verificado.',
        )
        showError(presentation.message, 'plan-detail', {
          label: 'Tentar novamente',
          run: () => void prepare(group),
        })
      }
    },
    [accessToken, showError],
  )

  const handleCardlessStart = useCallback(
    async (
      group: MarketplaceGroup,
      useVerifiedPhone: boolean,
      phone?: string,
      countryCode?: CountryCode,
    ) => {
      const blockedFor = verificationWaitSeconds()
      if (blockedFor > 0) {
        setInlineMessage(
          `Aguarde ${blockedFor} segundos antes de tentar novamente.`,
        )
        setStep(useVerifiedPhone ? 'whatsapp-choice' : 'whatsapp-phone')
        return
      }
      setInlineMessage(null)
      setStep('cardless-activating')
      try {
        const input = useVerifiedPhone
          ? ({ useVerifiedPhone: true } as const)
          : ({
              useVerifiedPhone: false,
              phone: phone!,
              countryCode: countryCode!,
            } as const)
        const result = await startCardlessTrial(accessToken, group.id, input)
        if (result.mode === 'verification_required') {
          setCardlessVerification(result)
          setStep('whatsapp-code')
        } else {
          void startEntitlementPolling(group.id, 'cardless-polling', 'access')
        }
      } catch (error) {
        const presentation = describePurchaseError(
          error,
          'Não foi possível iniciar o teste sem cartão.',
        )
        if (presentation.retryAfterSeconds) {
          verificationRetryAtRef.current =
            Date.now() + presentation.retryAfterSeconds * 1_000
        }
        if (presentation.code === 'trial_unavailable') {
          updateSelectedPlan({ trialEligible: false })
          setInlineMessage(presentation.message)
          setStep('plan-detail')
          return
        }
        setInlineMessage(presentation.message)
        setStep(useVerifiedPhone ? 'whatsapp-choice' : 'whatsapp-phone')
      }
    },
    [
      accessToken,
      startEntitlementPolling,
      updateSelectedPlan,
      verificationWaitSeconds,
    ],
  )

  const handleCardlessConfirm = useCallback(
    async (group: MarketplaceGroup, code: string) => {
      if (!cardlessVerification) return
      const blockedFor = verificationWaitSeconds()
      if (blockedFor > 0) {
        setInlineMessage(
          `Aguarde ${blockedFor} segundos antes de tentar novamente.`,
        )
        setStep('whatsapp-code')
        return
      }
      setInlineMessage(null)
      setStep('cardless-activating')
      try {
        const result = await confirmCardlessTrial(
          accessToken,
          cardlessVerification.verificationId,
          code,
        )
        if (result.mode === 'trial_activated') {
          void startEntitlementPolling(group.id, 'cardless-polling', 'access')
        } else {
          setCardlessVerification(result)
          setStep('whatsapp-code')
        }
      } catch (error) {
        const presentation = describePurchaseError(
          error,
          'Não foi possível confirmar o código.',
        )
        if (presentation.retryAfterSeconds) {
          verificationRetryAtRef.current =
            Date.now() + presentation.retryAfterSeconds * 1_000
        }
        setInlineMessage(presentation.message)
        if (
          presentation.code === 'verification_expired' ||
          presentation.code === 'verification_locked' ||
          presentation.code === 'verification_not_found'
        ) {
          setCardlessVerification(null)
          setStep('whatsapp-choice')
        } else {
          setStep('whatsapp-code')
        }
      }
    },
    [
      accessToken,
      cardlessVerification,
      startEntitlementPolling,
      verificationWaitSeconds,
    ],
  )

  const handleCardlessResend = useCallback(async () => {
    if (!cardlessVerification) return
    const blockedFor = verificationWaitSeconds()
    if (blockedFor > 0) {
      setInlineMessage(
        `Aguarde ${blockedFor} segundos antes de tentar novamente.`,
      )
      setStep('whatsapp-code')
      return
    }
    setInlineMessage(null)
    setStep('cardless-activating')
    try {
      const result = await resendCardlessTrialCode(
        accessToken,
        cardlessVerification.verificationId,
      )
      setCardlessVerification(result)
      setStep('whatsapp-code')
    } catch (error) {
      const presentation = describePurchaseError(
        error,
        'Não foi possível reenviar o código.',
      )
      if (presentation.retryAfterSeconds) {
        verificationRetryAtRef.current =
          Date.now() + presentation.retryAfterSeconds * 1_000
      }
      setInlineMessage(presentation.message)
      setStep('whatsapp-code')
    }
  }, [accessToken, cardlessVerification, verificationWaitSeconds])

  const handleFreeTokens = async (group: MarketplaceGroup) => {
    setStep('checkout'); setInlineMessage(null)
    try {
      const status = await setupFreeTokens(group.id, group.billingInterval)
      if (status.state === 'active') { void startEntitlementPolling(group.id, 'polling', 'access'); return }
      if (status.checkoutUrl) {
        setManualCheckoutUrl(status.checkoutUrl); setManualEntitlementRequirement('access')
        if (await openBrowser(status.checkoutUrl)) void startEntitlementPolling(group.id, 'polling', 'access')
        else setStep('manual-browser')
      } else { setInlineMessage(`Continue em ${status.activationUrl}`); setStep('plan-detail') }
    } catch { setInlineMessage('Não foi possível cadastrar o cartão. Tente novamente.'); setStep('plan-detail') }
  }

  const handleCheckout = useCallback(
    async function runCheckout(
      group: MarketplaceGroup,
      paymentMethod: PaymentMethod,
      woovi?: WooviCheckoutData,
      requirement: GroupEntitlementRequirement = 'paid',
    ) {
      setInlineMessage(null)
      setStep('checkout')
      try {
        const result = await createCheckoutSession(accessToken, group.id, {
          paymentMethod,
          woovi,
        })
        if (result.mode === 'reactivated') {
          void startEntitlementPolling(group.id, 'polling', requirement)
          return
        }
        if (result.mode === 'woovi') {
          setWooviPayment({
            qrCode: result.wooviQrCode,
            subscriptionId: result.wooviSubscriptionId,
          })
          setStep('woovi-qr')
          return
        }

        setManualCheckoutUrl(result.url)
        setManualEntitlementRequirement(requirement)
        if (await openBrowser(result.url)) {
          void startEntitlementPolling(group.id, 'polling', requirement)
        } else {
          setStep('manual-browser')
        }
      } catch (error) {
        const presentation = describePurchaseError(
          error,
          'Não foi possível criar o checkout.',
        )
        if (
          [
            'group_full',
            'group_waitlist_only',
            'waitlist_subscribers_only',
            'group_not_found',
          ].includes(presentation.code ?? '')
        ) {
          setPlans((current) => current.filter((plan) => plan.id !== group.id))
          showError(presentation.message, 'splash', {
            label: 'Atualizar catálogo',
            run: () => void fetchPlans(),
          })
          return
        }
        if (
          presentation.code === 'already_subscribed' ||
          presentation.code === 'manual_access_active'
        ) {
          setInlineMessage(presentation.message)
          void startEntitlementPolling(group.id, 'polling', requirement)
          return
        }
        if (
          presentation.code === 'payment_method_required' ||
          presentation.code === 'payment_method_unavailable'
        ) {
          setInlineMessage(presentation.message)
          setStep(
            group.paymentProvider === 'both' ? 'payment-method' : 'plan-detail',
          )
          return
        }
        showError(presentation.message, 'plan-detail', {
          label: 'Tentar checkout novamente',
          run: () => void runCheckout(group, paymentMethod, woovi, requirement),
        })
      }
    },
    [accessToken, fetchPlans, showError, startEntitlementPolling],
  )

  const startPaidPurchase = useCallback(
    async (group: MarketplaceGroup) => {
      setSelectedPlan(group)
      setInlineMessage(null)
      const currentSubscription = subscriptionsByGroup.get(group.id)
      if (
        currentSubscription?.source === 'stripe_trial' &&
        currentSubscription.status === 'trialing'
      ) {
        const conversionUrl = getStripeTrialConversionUrl(
          currentSubscription.id,
          group.billingInterval,
        )
        setManualCheckoutUrl(conversionUrl)
        setManualEntitlementRequirement('paid')
        setStep('checkout')
        if (await openBrowser(conversionUrl)) {
          void startEntitlementPolling(group.id, 'polling', 'paid')
        } else {
          setStep('manual-browser')
        }
        return
      }
      if (group.paymentProvider === 'both') setStep('payment-method')
      else if (group.paymentProvider === 'woovi') setStep('woovi-form')
      else void handleCheckout(group, 'stripe')
    },
    [handleCheckout, startEntitlementPolling, subscriptionsByGroup],
  )

  const cancelPlansLoading = useCallback(() => {
    plansRequestRef.current?.abort()
    plansRequestRef.current = null
    setStep('splash')
  }, [])

  useInput(
    (input, key) => {
      if (step === 'loading-plans') {
        if (key.escape) cancelPlansLoading()
        return
      }
      if (step !== 'plans' || plans.length === 0) return

      const direction = key.leftArrow
        ? 'left'
        : key.rightArrow
          ? 'right'
          : key.upArrow
            ? 'up'
            : key.downArrow
              ? 'down'
              : null
      if (direction) {
        setFocusIndex((index) =>
          movePlanFocus(index, direction, plans.length, columnCount),
        )
        return
      }
      if (/^[1-9]$/.test(input)) {
        const plan = plans[Number(input) - 1]
        if (plan) {
          setFocusIndex(Number(input) - 1)
          setSelectedPlan(plan)
          setInlineMessage(null)
          setStep('plan-detail')
        }
        return
      }
      if (key.return) {
        const plan = plans[focusIndex]
        if (plan) {
          setSelectedPlan(plan)
          setInlineMessage(null)
          setStep('plan-detail')
        }
      } else if (key.escape) {
        setStep('splash')
      }
    },
    { isActive: step === 'plans' || step === 'loading-plans' },
  )

  useInput(
    (_input, key) => {
      if (key.escape) {
        pollingRef.current?.abort()
        setStep('plan-detail')
      }
    },
    { isActive: step === 'polling' || step === 'cardless-polling' },
  )

  switch (step) {
    case 'splash':
      return (
        <Box flexDirection="column" gap={1}>
          <Text>Nenhum modelo disponível na sua conta.</Text>
          <Select
            options={[
              { label: 'Fechar', value: 'close' },
              { label: 'Ver planos', value: 'plans' },
            ]}
            onChange={(value: string) => {
              if (value === 'close') onDone(false)
              else void fetchPlans()
            }}
          />
        </Box>
      )

    case 'loading-plans':
      return (
        <Box flexDirection="column" gap={1}>
          <Text>Buscando planos disponíveis…</Text>
          <Spinner />
          <Text dimColor>Esc para cancelar</Text>
        </Box>
      )

    case 'plans': {
      const rows: MarketplaceGroup[][] = []
      for (let index = 0; index < plans.length; index += columnCount) {
        rows.push(plans.slice(index, index + columnCount))
      }
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Planos disponíveis</Text>
          <Text dimColor>
            Setas ou números para navegar · Enter para selecionar · Esc para
            voltar
          </Text>
          {inlineMessage ? <Text color="warning">{inlineMessage}</Text> : null}
          <Box flexDirection="column" gap={1}>
            {rows.map((row, rowIndex) => (
              <Box key={rowIndex} flexDirection="row" gap={2}>
                {row.map((plan, columnIndex) => {
                  const absoluteIndex = rowIndex * columnCount + columnIndex
                  const focused = absoluteIndex === focusIndex
                  return (
                    <Box
                      key={plan.id}
                      flexDirection="column"
                      borderStyle={focused ? 'bold' : 'round'}
                      borderColor={focused ? 'claude' : undefined}
                      paddingX={1}
                      flexGrow={1}
                      width={`${100 / columnCount}%`}
                    >
                      <Text bold wrap="truncate">
                        {absoluteIndex < 9 ? `[${absoluteIndex + 1}] ` : ''}
                        {plan.name}
                      </Text>
                      <Text>
                        {formatPrice(plan.priceCents, plan.currency)}
                        {formatInterval(plan.billingInterval)}
                      </Text>
                      <Text
                        dimColor
                        wrap="truncate"
                        title={getModelNames(plan)}
                      >
                        {getModelNames(plan)}
                      </Text>
                      <Text dimColor>{getSlotsInfo(plan)}</Text>
                      <Text dimColor>{paymentProviderLabel(plan)}</Text>
                      {(hasCardlessTrial(plan) || hasCardTrial(plan)) &&
                      plan.trialDays ? (
                        <Text color="success">
                          {plan.trialDays} dias de teste
                          {hasCardlessTrial(plan)
                            ? ' · sem cartão'
                            : ' · com cartão'}
                        </Text>
                      ) : null}
                    </Box>
                  )
                })}
                {row.length < columnCount
                  ? Array.from({ length: columnCount - row.length }).map(
                      (_, index) => (
                        <Box
                          key={`empty-${index}`}
                          flexGrow={1}
                          width={`${100 / columnCount}%`}
                        />
                      ),
                    )
                  : null}
              </Box>
            ))}
          </Box>
        </Box>
      )
    }

    case 'plan-detail': {
      if (!selectedPlan) return null
      const plan = selectedPlan
      const options = getPlanDetailOptions(plan)

      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            <Text bold>{plan.name}</Text>
            <Text>
              {formatPrice(plan.priceCents, plan.currency)}
              {formatInterval(plan.billingInterval)}
            </Text>
            <Text dimColor>Modelos: {getModelNames(plan)}</Text>
            <Text dimColor>Assinantes: {getSlotsInfo(plan)}</Text>
            <Text dimColor>Pagamento: {paymentProviderLabel(plan)}</Text>
            {(hasCardlessTrial(plan) || hasCardTrial(plan)) &&
            plan.trialDays ? (
              <Text color="success">
                Teste: {plan.trialDays} dias
                {hasCardlessTrial(plan)
                  ? ' · sem cartão'
                  : ' · cartão obrigatório'}
              </Text>
            ) : null}
          </Box>
          {inlineMessage ? <Text color="warning">{inlineMessage}</Text> : null}
          <Select
            options={options}
            onChange={(value: string) => {
              if (value === 'free-tokens') void handleFreeTokens(plan)
              else if (value === 'trial') void prepareCardlessTrial(plan)
              else if (value === 'card-trial')
                void handleCheckout(plan, 'stripe', undefined, 'access')
              else if (value === 'pix') setStep('woovi-form')
              else if (value === 'buy') void startPaidPurchase(plan)
              else setStep('plans')
            }}
          />
        </Box>
      )
    }

    case 'payment-method':
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Como deseja pagar?</Text>
          {inlineMessage ? <Text color="warning">{inlineMessage}</Text> : null}
          <Select
            options={[
              {
                label: 'Cartão de crédito',
                value: 'stripe',
                description: 'Checkout seguro da Stripe no navegador',
              },
              {
                label: 'Pix Automático',
                value: 'woovi',
                description: 'Aprove a recorrência pelo QR Code no terminal',
              },
              { label: 'Voltar', value: 'back' },
            ]}
            onChange={(value: string) => {
              if (value === 'back') setStep('plan-detail')
              else if (value === 'woovi') setStep('woovi-form')
              else if (selectedPlan) void handleCheckout(selectedPlan, 'stripe')
            }}
          />
        </Box>
      )

    case 'woovi-form':
      return (
        <Box flexDirection="column" gap={1}>
          {inlineMessage ? <Text color="warning">{inlineMessage}</Text> : null}
          <WooviPayerForm
            onCancel={() =>
              setStep(
                selectedPlan?.paymentProvider === 'both'
                  ? 'payment-method'
                  : 'plan-detail',
              )
            }
            onSubmit={(data) => {
              if (selectedPlan) void handleCheckout(selectedPlan, 'woovi', data)
            }}
          />
        </Box>
      )

    case 'whatsapp-choice': {
      if (!selectedPlan) return null
      const options = [
        ...(whatsappProfile?.verified
          ? [
              {
                label: `Usar WhatsApp verificado (${whatsappProfile.maskedPhone})`,
                value: 'verified',
                description: 'Ativa sem enviar um novo código',
              },
            ]
          : []),
        {
          label: 'Verificar um número de WhatsApp',
          value: 'new',
          description: 'Receba um código de 6 dígitos',
        },
        { label: 'Voltar', value: 'back' },
      ]
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Teste de {selectedPlan.trialDays} dias sem cartão</Text>
          <Text dimColor>
            O acesso termina ao fim do teste se você não adicionar uma forma de
            pagamento.
          </Text>
          {inlineMessage ? <Text color="warning">{inlineMessage}</Text> : null}
          <Select
            options={options}
            onChange={(value: string) => {
              if (value === 'verified')
                void handleCardlessStart(selectedPlan, true)
              else if (value === 'new') setStep('whatsapp-phone')
              else setStep('plan-detail')
            }}
          />
        </Box>
      )
    }

    case 'whatsapp-phone':
      return (
        <Box flexDirection="column" gap={1}>
          {inlineMessage ? <Text color="warning">{inlineMessage}</Text> : null}
          <CardlessPhoneForm
            initialCountry={whatsappProfile?.countryCode}
            onCancel={() => setStep('whatsapp-choice')}
            onSubmit={(phone, country) => {
              if (selectedPlan) {
                void handleCardlessStart(selectedPlan, false, phone, country)
              }
            }}
          />
        </Box>
      )

    case 'whatsapp-code':
      return cardlessVerification && selectedPlan ? (
        <Box flexDirection="column" gap={1}>
          {inlineMessage ? <Text color="warning">{inlineMessage}</Text> : null}
          <CardlessCodeForm
            verification={cardlessVerification}
            onConfirm={(code) => void handleCardlessConfirm(selectedPlan, code)}
            onResend={() => void handleCardlessResend()}
          />
        </Box>
      ) : null

    case 'cardless-activating':
      return (
        <Box flexDirection="column" gap={1}>
          <Text>Preparando o teste sem cartão…</Text>
          <Spinner />
        </Box>
      )

    case 'cardless-polling':
      return (
        <Box flexDirection="column" gap={1}>
          <Text>Teste ativado. Aguardando a liberação dos modelos…</Text>
          <Spinner />
          <Text dimColor>Esc para parar a verificação</Text>
        </Box>
      )

    case 'checkout':
      return (
        <Box flexDirection="column" gap={1}>
          <Text>Criando checkout…</Text>
          <Spinner />
        </Box>
      )

    case 'polling':
      return (
        <Box flexDirection="column" gap={1}>
          <Text>Aguardando a confirmação e a liberação dos modelos…</Text>
          <Spinner />
          <Text dimColor>Esc para parar a verificação</Text>
        </Box>
      )

    case 'manual-browser':
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="warning">
            Não foi possível abrir o navegador automaticamente.
          </Text>
          <Text>Abra este endereço manualmente:</Text>
          <Text>{manualCheckoutUrl}</Text>
          <Select
            options={[
              {
                label: 'Já abri o checkout; verificar pagamento',
                value: 'verify',
              },
              { label: 'Voltar ao plano', value: 'back' },
              { label: 'Fechar', value: 'close' },
            ]}
            onChange={(value: string) => {
              if (value === 'verify' && selectedPlan) {
                void startEntitlementPolling(
                  selectedPlan.id,
                  'polling',
                  manualEntitlementRequirement,
                )
              } else if (value === 'back') setStep('plan-detail')
              else onDone(false)
            }}
          />
        </Box>
      )

    case 'woovi-qr':
      return wooviPayment && selectedPlan ? (
        <WooviPaymentView
          accessToken={accessToken}
          qrCode={wooviPayment.qrCode}
          subscriptionId={wooviPayment.subscriptionId}
          onCancel={() => onDone(false)}
          onConfirmed={() => void startEntitlementPolling(selectedPlan.id)}
          onError={(error) => {
            const presentation = describePurchaseError(
              error,
              'Não foi possível verificar o pagamento Pix.',
            )
            showError(presentation.message, 'woovi-qr')
          }}
        />
      ) : null

    case 'success':
      return (
        <Text color="success">
          {successRequirement === 'access'
            ? 'Trial ativado! Modelos disponíveis.'
            : 'Assinatura paga confirmada! Modelos disponíveis.'}
        </Text>
      )

    case 'error':
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="red">Erro: {flowError?.message}</Text>
          <Select
            options={[
              ...(flowError?.retryLabel
                ? [{ label: flowError.retryLabel, value: 'retry' }]
                : []),
              { label: 'Voltar', value: 'back' },
              { label: 'Fechar', value: 'close' },
            ]}
            onChange={(value: string) => {
              if (value === 'retry') retryRef.current?.()
              else if (value === 'back')
                setStep(flowError?.backStep ?? 'splash')
              else onDone(false)
            }}
          />
        </Box>
      )
  }
}

export function StandalonePurchaseFlowView({
  accessToken,
  onDone,
}: {
  accessToken: string
  onDone: (result: boolean) => void
}) {
  // Startup purchase flows run before the regular application tree exists.
  // AppStateProvider also installs the VoiceProvider required by TextInput in
  // VOICE_MODE builds, including the Linux release bundle.
  return (
    <AppStateProvider>
      <PurchaseFlowView accessToken={accessToken} onDone={onDone} />
    </AppStateProvider>
  )
}

export async function showNoModelsFlow(accessToken: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let instance: { unmount: () => void } | null = null
    let pendingResult: boolean | null = null
    const finish = (result: boolean) => {
      if (!instance) {
        pendingResult = result
        return
      }
      instance.unmount()
      setTimeout(() => resolve(result), 50)
    }

    render(
      <StandalonePurchaseFlowView accessToken={accessToken} onDone={finish} />,
    ).then((created) => {
      instance = created
      if (pendingResult !== null) finish(pendingResult)
    })
  })
}
