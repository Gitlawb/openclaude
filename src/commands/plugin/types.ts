import type { LocalJSXCommandOnDone } from '../../types/command.js'

export type ViewState =
  | { type: 'menu' }
  | { type: 'help' }
  | { type: 'validate'; path?: string }
  | { type: 'discover-plugins'; targetPlugin?: string }
  | {
      type: 'browse-marketplace'
      targetMarketplace?: string
      targetPlugin?: string
    }
  | {
      type: 'manage-plugins'
      targetPlugin?: string
      targetMarketplace?: string
      action?: 'enable' | 'disable' | 'uninstall'
    }
  | { type: 'marketplace-list' }
  | { type: 'marketplace-menu' }
  | { type: 'add-marketplace'; initialValue?: string }
  | {
      type: 'manage-marketplaces'
      targetMarketplace?: string
      action?: 'remove' | 'update'
    }

export type PluginSettingsProps = {
  onComplete: LocalJSXCommandOnDone
  args?: string
  showMcpRedirectMessage?: boolean
}
