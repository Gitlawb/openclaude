import { VerbooApiError } from '../api/verbooApiError.js'

const BUSINESS_MESSAGES: Record<string, string> = {
  purchase_attempt_failed: 'Esta compra não foi concluída. Consulte a tentativa no billing antes de tentar novamente.',
  purchase_attempt_expired: 'Esta tentativa expirou. Consulte o billing para iniciar uma nova compra.',
  purchase_attempt_review: 'Esta compra está em conciliação. Consulte o billing ou o suporte; não é necessário iniciar outro pagamento.',
 checkout_intent_required: 'Você já tem um contrato. Continue no billing para trocar ou confirmar uma assinatura adicional.',
 checkout_in_progress: 'Sua compra está em processamento. Retome a mesma tentativa no billing.',
 checkout_request_conflict: 'Esta tentativa pertence a outra seleção. Consulte o billing antes de iniciar outra compra.',

  trial_unavailable: 'Este teste já foi utilizado ou não está mais disponível.',
  group_full: 'Este plano atingiu o limite de assinantes.',
  manual_access_active:
    'Você já possui acesso manual a este plano. Fale com o suporte para alterá-lo.',
  payment_past_due:
    'Existe um pagamento pendente para este plano. Regularize a assinatura antes de continuar.',
  already_subscribed: 'Você já possui uma assinatura ativa para este plano.',
  payment_method_required: 'Escolha uma forma de pagamento para continuar.',
  payment_method_unavailable:
    'A forma de pagamento escolhida não está disponível para este plano.',
  invalid_woovi_checkout:
    'Confira o CPF e o celular informados para o Pix Automático.',
  checkout_pending:
    'Já existe um checkout Pix em processamento. Aguarde alguns instantes e verifique novamente.',
  checkout_verification_failed:
    'Não foi possível verificar o checkout Pix pendente. Tente novamente em instantes.',
  woovi_cancellation_pending:
    'A assinatura Pix cancelada continua ativa até o fim do período atual.',
  woovi_cancel_not_reversible:
    'Este cancelamento Pix não pode ser revertido. Aguarde o fim do período para assinar novamente.',
  trial_conversion_unavailable:
    'Este teste não pode ser convertido em assinatura no momento.',
  trial_payment_method_missing:
    'Adicione uma forma de pagamento antes de converter este teste.',
  trial_conversion_pending:
    'A conversão deste teste já está sendo processada. Aguarde alguns instantes.',
  group_waitlist_only:
    'Este plano exige entrada pela lista de espera e não pode ser comprado pela CLI.',
  waitlist_subscribers_only:
    'Este plano está restrito a participantes da lista de espera.',
  whatsapp_phone_invalid: 'Informe um número de WhatsApp válido.',
  whatsapp_phone_unavailable: 'Este WhatsApp já está vinculado a outra conta.',
  verification_not_found:
    'A verificação não foi encontrada. Inicie o teste novamente.',
  verification_expired: 'O código expirou. Solicite um novo código.',
  verification_locked:
    'A verificação foi bloqueada após muitas tentativas. Inicie novamente.',
  verification_invalid: 'O código informado está incorreto.',
  group_not_found: 'Este plano não está mais disponível.',
  not_member: 'Sua sessão não tem permissão para concluir esta operação.',
  invalid_request: 'Confira os dados informados e tente novamente.',
  invalid_checkout_request: 'Os dados enviados ao checkout são inválidos.',
  invalid_group_id: 'O identificador deste plano é inválido.',
  invalid_verification_id: 'A verificação não é mais válida. Inicie novamente.',
}

export type PurchaseErrorPresentation = {
  code?: string
  message: string
  retryAfterSeconds?: number
}

export function describePurchaseError(
  error: unknown,
  fallback: string,
): PurchaseErrorPresentation {
  if (!(error instanceof VerbooApiError)) {
    return { message: fallback }
  }

  if (error.code === 'rate_limited') {
    const wait = error.retryAfterSeconds
      ? ` Aguarde ${error.retryAfterSeconds} segundos.`
      : ' Aguarde alguns instantes.'
    return {
      code: error.code,
      message: `Muitas tentativas foram feitas.${wait}`,
      retryAfterSeconds: error.retryAfterSeconds,
    }
  }

  const businessMessage = error.code ? BUSINESS_MESSAGES[error.code] : undefined
  if (businessMessage) {
    return {
      code: error.code,
      message: businessMessage,
      retryAfterSeconds: error.retryAfterSeconds,
    }
  }

  if (error.status === 401 || error.status === 403) {
    return {
      code: error.code,
      message:
        'Sua sessão expirou ou não tem permissão. Entre novamente no Verboo.',
    }
  }

  if (error.kind === 'contract') {
    return {
      code: error.code,
      message:
        'O serviço retornou dados incompatíveis. Atualize o Verboo ou tente novamente mais tarde.',
    }
  }
  if (error.kind === 'network') {
    return {
      code: error.code,
      message:
        'Não foi possível se comunicar com o Verboo. Verifique sua conexão e tente novamente.',
    }
  }
  if (error.status && error.status >= 500) {
    return {
      code: error.code,
      message:
        'O serviço de pagamentos está temporariamente indisponível. Tente novamente em instantes.',
    }
  }
  return { code: error.code, message: fallback }
}
