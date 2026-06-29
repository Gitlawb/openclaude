import chalk from 'chalk'
import { stat } from 'fs/promises'
import { dirname, resolve } from 'path'
import type { ToolPermissionContext } from '../Tool.js'
import { getErrnoCode } from './errors.js'
import { expandPath } from './path.js'
import {
  allWorkingDirectories,
  pathInWorkingPath,
} from './permissions/filesystem.js'

export type AddDirectoryResult =
  | {
      resultType: 'success'
      absolutePath: string
    }
  | {
      resultType: 'emptyPath'
    }
  | {
      resultType: 'pathNotFound' | 'notADirectory'
      directoryPath: string
      absolutePath: string
    }
  | {
      resultType: 'alreadyInWorkingDirectory'
      directoryPath: string
      workingDir: string
    }

export async function validateDirectoryForWorkspace(
  directoryPath: string,
  permissionContext: ToolPermissionContext,
): Promise<AddDirectoryResult> {
  if (!directoryPath) {
    return {
      resultType: 'emptyPath',
    }
  }

  const absolutePath = resolve(expandPath(directoryPath))

  try {
    const stats = await stat(absolutePath)
    if (!stats.isDirectory()) {
      return {
        resultType: 'notADirectory',
        directoryPath,
        absolutePath,
      }
    }
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (
      code === 'ENOENT' ||
      code === 'ENOTDIR' ||
      code === 'EACCES' ||
      code === 'EPERM'
    ) {
      return {
        resultType: 'pathNotFound',
        directoryPath,
        absolutePath,
      }
    }
    throw e
  }

  const currentWorkingDirs = allWorkingDirectories(permissionContext)

  for (const workingDir of currentWorkingDirs) {
    if (pathInWorkingPath(absolutePath, workingDir)) {
      return {
        resultType: 'alreadyInWorkingDirectory',
        directoryPath,
        workingDir,
      }
    }
  }

  return {
    resultType: 'success',
    absolutePath,
  }
}

export function addDirHelpMessage(result: AddDirectoryResult): string {
  switch (result.resultType) {
    case 'emptyPath':
      return 'Please provide a directory path.'
    case 'pathNotFound':
      return `Path ${chalk.bold(result.absolutePath)} was not found.`
    case 'notADirectory': {
      const parentDir = dirname(result.absolutePath)
      return `${chalk.bold(result.directoryPath)} is not a directory. Did you mean to add the parent directory ${chalk.bold(parentDir)}?`
    }
    case 'alreadyInWorkingDirectory':
      return `${chalk.bold(result.directoryPath)} is already accessible within the existing working directory ${chalk.bold(result.workingDir)}.`
    case 'success':
      return `Added ${chalk.bold(result.absolutePath)} as a working directory.`
  }
}
