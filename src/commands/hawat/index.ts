/**
 * Hawat commands — Forge registration barrel
 *
 * Exports Forge Command objects for all Hawat CLI operations.
 * These get imported into src/commands.ts and added to the COMMANDS array.
 */
import type { Command } from '../types/command.js'

// forge init — initialize Hawat orchestration in a project
export const hawatInit: Command = {
  type: 'local',
  name: 'hawat-init',
  description: 'Initialize Hawat orchestration in the current project',
  aliases: ['hi'],
  source: 'bundled',
  supportsNonInteractive: true,
  async load() {
    const { call } = await import('./init.js')
    return { call }
  },
}

// forge doctor — health check for Hawat setup
export const hawatDoctor: Command = {
  type: 'local',
  name: 'hawat-doctor',
  description: 'Check Hawat installation health (config, skills, scripts)',
  aliases: ['hd'],
  source: 'bundled',
  supportsNonInteractive: true,
  async load() {
    const { call } = await import('./doctor.js')
    return { call }
  },
}

// forge install — install global Hawat components
export const hawatInstall: Command = {
  type: 'local',
  name: 'hawat-install',
  description: 'Install Hawat global components (skills, scripts, templates)',
  source: 'bundled',
  supportsNonInteractive: true,
  async load() {
    const { call } = await import('./install.js')
    return { call }
  },
}

// forge update — update project Hawat files
export const hawatUpdate: Command = {
  type: 'local',
  name: 'hawat-update',
  description: 'Update project Hawat files to latest templates',
  source: 'bundled',
  supportsNonInteractive: true,
  async load() {
    const { call } = await import('./update.js')
    return { call }
  },
}

// forge uninstall — remove Hawat files
export const hawatUninstall: Command = {
  type: 'local',
  name: 'hawat-uninstall',
  description: 'Remove Hawat project and/or global files',
  source: 'bundled',
  supportsNonInteractive: true,
  async load() {
    const { call } = await import('./uninstall.js')
    return { call }
  },
}
