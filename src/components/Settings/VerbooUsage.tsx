import * as React from 'react'

import { fetchFreeTokenStatus, type FreeTokenStatus } from '../../services/api/verbooFreeTokens.js'
import { Box, Text } from '../../ink.js'
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js'

export function VerbooUsage({
  showCancelHint = true,
}: {
  showCancelHint?: boolean
}): React.ReactNode {
  const [status, setStatus] = React.useState<FreeTokenStatus | null>(null)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => {
    const controller = new AbortController()
    const load = () => { void fetchFreeTokenStatus(controller.signal).then(value => { if (!controller.signal.aborted) { setStatus(value); setFailed(false) } }).catch(() => { if (!controller.signal.aborted) setFailed(true) }) }
    load()
    const timer = setInterval(load, 10_000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [])
  const free = status && ['active', 'exhausted', 'activating', 'checkout_required'].includes(status.state)

  return (
    <Box flexDirection="column" gap={1}>
      {!status && !failed && <Text>Carregando consumo…</Text>}
      {failed && <Text color="yellow">Não foi possível consultar o saldo. Tente novamente.</Text>}
      {free ? <>
        <Text bold>{status.tokensRemaining.toLocaleString('pt-BR')} tokens grátis restantes</Text>
        <Text>{status.tokensUsed.toLocaleString('pt-BR')} consumidos de {status.tokenLimit.toLocaleString('pt-BR')}. Entrada + saída, sem prazo de validade.</Text>
        {status.accountingPending && <Text color="yellow">Consumo pendente de confirmação. Novas inferências estão pausadas.</Text>}
        <Text>Quando os tokens acabarem, a CLI pausará a inferência e mostrará as opções de ativação com o valor da cobrança no cartão cadastrado.</Text>
      </> : status ? <Text>Consulte seu uso no painel: https://code.verboo.ai/dashboard</Text> : null}
      {showCancelHint ? <Text dimColor>
        <ConfigurableShortcutHint
          action="confirm:no"
          context="Settings"
          fallback="Esc"
          description="cancel"
        />
      </Text> : null}
    </Box>
  )
}
