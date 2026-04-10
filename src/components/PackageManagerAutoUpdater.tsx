import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useInterval } from 'usehooks-ts'
import { Text } from '../ink.js'
import {
  type AutoUpdaterResult,
  getLatestVersionFromGcs,
  getMaxVersion,
  shouldSkipVersion,
} from '../utils/autoUpdater.js'
import { isAutoUpdaterDisabled } from '../utils/config.js'
import { logForDebugging } from '../utils/debug.js'
import {
  getPackageManager,
  type PackageManager,
} from '../utils/nativeInstaller/packageManagers.js'
import { gt, gte } from '../utils/semver.js'
import { getInitialSettings } from '../utils/settings/settings.js'

type Props = {
  isUpdating: boolean
  onChangeIsUpdating: (isUpdating: boolean) => void
  onAutoUpdaterResult: (autoUpdaterResult: AutoUpdaterResult) => void
  autoUpdaterResult: AutoUpdaterResult | null
  showSuccessMessage: boolean
  verbose: boolean
}

function getPackageManagerUpdateCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case 'homebrew':
      return 'brew upgrade --cask openclaude'
    case 'winget':
      return 'winget upgrade OpenClaude'
    case 'apk':
      return 'apk upgrade openclaude'
    default:
      return 'Use your package manager to update OpenClaude'
  }
}

export function PackageManagerAutoUpdater({
  verbose,
  onAutoUpdaterResult,
}: Props): React.ReactNode {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [packageManager, setPackageManager] = useState<PackageManager>('unknown')
  const updateAvailableRef = useRef(updateAvailable)
  updateAvailableRef.current = updateAvailable

  const checkForUpdates = React.useCallback(async () => {
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      return
    }

    if (isAutoUpdaterDisabled()) {
      return
    }

    const [channel, pm] = await Promise.all([
      Promise.resolve(getInitialSettings()?.autoUpdatesChannel ?? 'latest'),
      getPackageManager(),
    ])
    setPackageManager(pm)

    let latest = await getLatestVersionFromGcs(channel)
    const maxVersion = await getMaxVersion()
    if (maxVersion && latest && gt(latest, maxVersion)) {
      logForDebugging(
        `PackageManagerAutoUpdater: maxVersion ${maxVersion} is set, capping update from ${latest} to ${maxVersion}`,
      )
      if (gte(MACRO.VERSION, maxVersion)) {
        logForDebugging(
          `PackageManagerAutoUpdater: current version ${MACRO.VERSION} is already at or above maxVersion ${maxVersion}, skipping update`,
        )
        setUpdateAvailable(false)
        return
      }
      latest = maxVersion
    }

    const hasUpdate =
      !!latest && !gte(MACRO.VERSION, latest) && !shouldSkipVersion(latest)
    setUpdateAvailable(hasUpdate)

    if (hasUpdate && latest) {
      logForDebugging(
        `PackageManagerAutoUpdater: Update available ${MACRO.VERSION} -> ${latest}`,
      )
      onAutoUpdaterResult({
        version: latest,
        currentVersion: MACRO.VERSION,
        status: 'update_available',
        actionLabel: getPackageManagerUpdateCommand(pm),
      })
      return
    }

    if (updateAvailableRef.current) {
      onAutoUpdaterResult({
        version: latest,
        currentVersion: MACRO.VERSION,
        status: 'up_to_date',
      })
    }
  }, [onAutoUpdaterResult])

  useEffect(() => {
    void checkForUpdates()
  }, [checkForUpdates])

  useInterval(checkForUpdates, 30 * 60 * 1000)

  if (!updateAvailable) {
    return null
  }

  const updateCommand = getPackageManagerUpdateCommand(packageManager)

  return (
    <>
      {verbose && (
        <Text dimColor wrap="truncate">
          currentVersion: {MACRO.VERSION}
        </Text>
      )}
      <Text color="warning" wrap="truncate">
        Update available{' '}
        {`: ${MACRO.VERSION} → ${autoUpdaterResult?.version ?? 'newer version available'}`} Run:{' '}
        <Text bold>{updateCommand}</Text>
      </Text>
    </>
  )
}
