import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function getWebUI(): string {
  const css = readFileSync(join(__dirname, 'client/styles.css'), 'utf8')
  const body = readFileSync(join(__dirname, 'client/app.html'), 'utf8')
  const js = readFileSync(join(__dirname, 'client/app.js'), 'utf8')
  const version = (globalThis as Record<string, unknown>).MACRO
    ? ((globalThis as Record<string, unknown>).MACRO as Record<string, string>).VERSION || '0.0.0'
    : '0.0.0'
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenClaude</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b5cf6' stroke-width='2.5' stroke-linecap='round'><polyline points='4 17 10 11 4 5'/><line x1='12' y1='19' x2='20' y2='19'/></svg>">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark-dimmed.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/15.0.7/marked.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.2.4/purify.min.js"></script>
<style>
${css}
</style>
</head>
<body>
${body}
<script>
var __APP_VERSION__ = ${JSON.stringify('v' + version)};
(function() { var el = document.getElementById('version-label'); if (el) el.textContent = __APP_VERSION__; })();
${js}
</script>
</body>
</html>`
}
