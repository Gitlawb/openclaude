import type { Command, LocalCommandCall } from '../../types/command.js'

const call: LocalCommandCall = async () => {
  const { loadMachineConfig, saveMachineConfig } = await import(
    '../../vault/globalConfig.js'
  )
  const cfg = loadMachineConfig()

  if (cfg.declinedGlobalVault !== true) {
    return {
      type: 'text',
      value: 'Global vault is not currently declined. Nothing to do.',
    }
  }

  saveMachineConfig({ ...cfg, declinedGlobalVault: false })

  return {
    type: 'text',
    value:
      'Global vault re-enabled. The next `bridgeai` invocation will prompt to set it up.',
  }
}

const vaultEnableGlobal = {
  type: 'local',
  name: 'vault-enable-global',
  description:
    'Reverse a prior decline of the global vault prompt. Next `bridgeai` invocation will re-prompt.',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default vaultEnableGlobal
