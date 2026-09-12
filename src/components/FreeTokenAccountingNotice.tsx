import { Text } from '../ink.js'
import type { FreeTokenStatus } from '../services/api/verbooFreeTokens.js'

export function FreeTokenAccountingNotice({ status }: { status: FreeTokenStatus }) {
  const blocked = status.accountingBlocked ?? status.accountingPending
  if (status.accountingOpenRequests === undefined || status.accountingRequestLimit === undefined) {
    return blocked ? <Text color="yellow">Limite de solicitações aguardando contabilização atingido. Novas inferências gratuitas estão pausadas.</Text> : null
  }
  return <Text color={blocked ? 'yellow' : undefined}>
    {status.accountingOpenRequests}/{status.accountingRequestLimit} solicitações aguardando contabilização · {blocked ? 'Uso gratuito pausado até a confirmação do consumo.' : status.state === 'active' ? 'Uso liberado.' : 'Sem bloqueio de contabilização.'}
  </Text>
}
