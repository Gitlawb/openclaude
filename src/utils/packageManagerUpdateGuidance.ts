import type { PackageManager } from './nativeInstaller/packageManagers.js'
import { PRODUCT_DISPLAY_NAME } from '../constants/product.js'

const UPSTREAM_PACKAGE_URL = '@anthropic-ai/claude-code'

const upstreamCommands: Partial<Record<PackageManager, string>> = {
  homebrew: 'brew upgrade claude-code',
  winget: 'winget upgrade Anthropic.ClaudeCode',
  apk: 'apk upgrade claude-code',
}

const managerNames: Partial<Record<PackageManager, string>> = {
  homebrew: 'Homebrew',
  winget: 'winget',
  apk: 'apk',
}

export type PackageManagerUpdateGuidance = {
  message: string
  managerName?: string
  command?: string
}

export function resolvePackageManagerUpdateGuidance(
  manager: PackageManager,
  packageUrl: string,
): PackageManagerUpdateGuidance {
  const managerName = managerNames[manager]
  if (!managerName) {
    return {
      message:
        `${PRODUCT_DISPLAY_NAME} is managed by a package manager. Use your package manager to update ${PRODUCT_DISPLAY_NAME}.`,
    }
  }

  const command =
    packageUrl === UPSTREAM_PACKAGE_URL
      ? upstreamCommands[manager]
      : undefined

  return {
    message: `${PRODUCT_DISPLAY_NAME} is managed by ${managerName}. Use ${managerName} to update ${PRODUCT_DISPLAY_NAME}.`,
    managerName,
    ...(command ? { command } : {}),
  }
}

export function getPackageManagerUpdateGuidance(
  manager: PackageManager,
): PackageManagerUpdateGuidance {
  return resolvePackageManagerUpdateGuidance(manager, MACRO.PACKAGE_URL)
}
