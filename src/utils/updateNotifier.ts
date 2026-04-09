import chalk from 'chalk'
import { getLatestVersion } from './autoUpdater.js'
import { logForDebugging } from './debug.js'
import { lt } from './semver.js'
import { getInitialSettings } from './settings/settings.js'

/**
 * Checks for a newer version on npm and suggests the user to update.
 * Does not block startup.
 */
export async function notifyUpdates(): Promise<void> {
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.NODE_ENV === 'development' ||
    process.env.OPENCLAUDE_SKIP_UPDATE_CHECK === 'true'
  ) {
    return
  }

  try {
    const channel = getInitialSettings()?.autoUpdatesChannel ?? 'latest'
    const latestVersion = await getLatestVersion(channel)

    const currentVersion =
      typeof MACRO !== 'undefined'
        ? (MACRO.DISPLAY_VERSION ?? MACRO.VERSION)
        : '0.0.0'

    if (latestVersion && lt(currentVersion, latestVersion)) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(
        chalk.green(`
A new version of Open Claude is available: \${latestVersion} (current: \${currentVersion})
To update, please run:
    npm install -g \${MACRO.PACKAGE_URL}
`),
      )
    }
  } catch (error) {
    logForDebugging(`notifyUpdates failed: \${error}`)
  }
}
