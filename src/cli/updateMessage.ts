export function getSourceBuildUpdateMessage(): string {
  return [
    'Auto-update is only available for OpenClaude npm package installs.',
    '',
    'You are running from source or an unpackaged build.',
    '',
    'To update this checkout, pull the latest source and rebuild:',
    '  git pull && bun install && bun run build',
    '',
    'Or install/update the published npm package:',
    `  npm install -g ${MACRO.PACKAGE_URL}@latest`,
  ].join('\n')
}
