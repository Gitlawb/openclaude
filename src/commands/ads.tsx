import * as React from 'react'
import { Box, Text, useInput } from '../ink.js'
import TextInput from '../components/TextInput.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import type { Command } from '../commands.js'
import type { LocalJSXCommandCall } from '../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'

function statusText(): string {
  const ads = getGlobalConfig().ads
  if (!ads?.enabled) {
    return [
      'Sponsored tips: off',
      'Enable with "/ads on" to earn opengateway credits while you code.',
      'Get your code from the Earn tab at gitlawb.com/opengateway.',
    ].join('\n')
  }
  const masked = ads.earnCode ? `${ads.earnCode.slice(0, 6)}…` : '(none)'
  return [
    `Sponsored tips: on  (earn code ${masked})`,
    'You earn opengateway credits when a tip is shown during loading.',
    'Turn off any time with "/ads off".',
  ].join('\n')
}

/**
 * Persist the code and return the confirmation message. Earning happens only on
 * the per-turn rendered-tip path (a viewer must actually see a tip to be
 * credited); we intentionally do NOT fetch/confirm an unshown impression here.
 */
function enableWithCode(code: string): string {
  saveGlobalConfig(c => ({
    ...c,
    ads: { ...(c.ads ?? {}), enabled: true, earnCode: code },
  }))
  return [
    "Sponsored tips enabled — you'll see them during loading and earn",
    'opengateway credits each time. Your recent prompt (with best-effort secret',
    'redaction) is shared with our ad partner to match a relevant tip.',
    'Run /ads to check or change sponsored tips.',
  ].join('\n')
}

/**
 * Masked paste dialog for the earn code — same UX as entering a provider API
 * key (TextInput mask="*"), so the credential never appears in plaintext.
 */
function AdsCodeDialog({
  onSubmit,
  onCancel,
  warnExposed = false,
}: {
  onSubmit: (code: string) => void
  onCancel: () => void
  warnExposed?: boolean
}): React.ReactNode {
  const [value, setValue] = React.useState('')
  const [cursorOffset, setCursorOffset] = React.useState(0)
  const { columns } = useTerminalSize()

  useInput((_input, key) => {
    if (key.escape) onCancel()
  })

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Text bold>Enable sponsored tips · earn opengateway credits</Text>
      {warnExposed ? (
        <Text color="warning">
          You typed a code on the command line — it&apos;s now visible in your terminal.
          Rotate it in the Earn tab and paste the new one here.
        </Text>
      ) : null}
      <Text dimColor>
        Paste your earn code (gitlawb.com/opengateway → Earn). It stays hidden as you type.
      </Text>
      <Text dimColor>
        Tips are contextual: your most recent prompt (with best-effort secret redaction)
        is shared with our ad partner to match a relevant tip. Disable any time with /ads off.
      </Text>
      <Box flexDirection="row" gap={1}>
        <Text>›</Text>
        <TextInput
          value={value}
          onChange={setValue}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          columns={Math.max(20, columns - 8)}
          mask="*"
          placeholder="earn_…"
          onSubmit={v => {
            const code = v.trim()
            if (code) onSubmit(code)
            else onCancel()
          }}
        />
      </Box>
      <Text dimColor>enter to enable · esc to cancel</Text>
    </Box>
  )
}

/**
 * `/ads on` always opens a masked paste dialog and never accepts an inline code
 * (a code typed inline is already exposed in the terminal scrollback). `/ads off`
 * disables and clears the stored code. `/ads` shows status. Inline-code args are
 * also redacted from history via `isSensitive` below.
 */
export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const parts = (args ?? '').trim().split(/\s+/).filter(Boolean)
  const sub = (parts[0] ?? '').toLowerCase()

  if (sub === 'off') {
    const wasOn = getGlobalConfig().ads?.enabled
    // Drop the stored earn code on opt-out — it's a credential, and keeping it at
    // rest after the user disabled earning has no benefit.
    saveGlobalConfig(c => {
      const { earnCode: _earnCode, ...restAds } = c.ads ?? {}
      return { ...c, ads: { ...restAds, enabled: false } }
    })
    onDone(wasOn ? 'Sponsored tips disabled.' : 'Sponsored tips are already off.', {
      display: 'system',
    })
    return null
  }

  if (sub === 'on') {
    // Never accept the code inline — the terminal echoes keystrokes as you type,
    // so an inline `/ads on <code>` leaks the credential into your scrollback no
    // matter what we do afterward. Always collect it through the masked dialog.
    // If a code WAS typed inline, it's already exposed → warn to rotate it.
    const typedInline = parts.length > 1
    return (
      <AdsCodeDialog
        warnExposed={typedInline}
        onSubmit={code => onDone(enableWithCode(code), { display: 'system' })}
        onCancel={() =>
          onDone('Cancelled — sponsored tips not enabled.', { display: 'system' })
        }
      />
    )
  }

  onDone(statusText(), { display: 'system' })
  return null
}

const ads = {
  type: 'local-jsx',
  name: 'ads',
  description: 'Earn opengateway credits from sponsored tips (ads.gitlawb.com)',
  argumentHint: 'on | off',
  // The earn code is a credential — redact inline `/ads on <code>` args from history.
  isSensitive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default ads
