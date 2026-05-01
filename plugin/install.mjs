#!/usr/bin/env node
// Copies plugin artifacts to a vault's .obsidian/plugins/openclaude-obsidian/
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const vaultPath = process.argv[2];

if (!vaultPath) {
  console.error('Usage: node install.mjs <vault-path>');
  console.error('Example: node install.mjs "G:/Meu Drive/Energinova_Hub"');
  process.exit(1);
}

const pluginDir = join(resolve(vaultPath), '.obsidian', 'plugins', 'openclaude-obsidian');
if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true });

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  const src = join(__dir, file);
  if (!existsSync(src)) {
    console.error(`Missing build artifact: ${src}`);
    console.error('Run "npm run build" first.');
    process.exit(1);
  }
  copyFileSync(src, join(pluginDir, file));
  console.log(`  ✓ ${file}`);
}
console.log(`\nInstalled to: ${pluginDir}`);
console.log('In Obsidian: Settings → Community Plugins → enable "OpenClaude".');
