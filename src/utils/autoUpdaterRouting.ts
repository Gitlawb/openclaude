import type { InstallMethod } from './config.js'
import type { InstallationType } from './doctorDiagnostic.js'

export function getAutoUpdaterNpmMethod(
  installationType: InstallationType,
  configInstallMethod: InstallMethod | undefined,
  nativeDistributionAvailable: boolean,
): 'local' | 'global' | null {
  if (installationType === 'npm-local') {
    return 'local'
  }
  if (installationType === 'npm-global') {
    return 'global'
  }
  if (installationType === 'native') {
    return nativeDistributionAvailable ? null : 'global'
  }
  if (installationType === 'unknown') {
    return configInstallMethod === 'local' ? 'local' : 'global'
  }
  return null
}

export function shouldUseNativeAutoUpdater(
  installationType: InstallationType,
  nativeDistributionAvailable: boolean,
): boolean {
  return installationType === 'native' && nativeDistributionAvailable
}

export function shouldRemoveInstalledSymlinkForNpmUpdate(
  configInstallMethod: InstallMethod | undefined,
  nativeDistributionAvailable: boolean,
): boolean {
  return configInstallMethod !== 'native' || !nativeDistributionAvailable
}
