import { basename, join } from 'path'

import type { MemoryFileInfo } from '../../utils/claudemd.js'
import {
  findProjectInstructionFilePathInAncestors,
  isProjectInstructionFileName,
  PRIMARY_PROJECT_INSTRUCTION_FILE,
} from '../../utils/projectInstructions.js'

function joinWithInputSeparator(basePath: string, childPath: string): string {
  if (basePath.includes('/') && !basePath.includes('\\')) {
    return `${basePath.replace(/\/+$/, '')}/${childPath}`
  }
  return join(basePath, childPath)
}

function isLoadedProjectInstructionFile(file: MemoryFileInfo): boolean {
  return (
    file.type === 'Project' &&
    file.parent === undefined &&
    isProjectInstructionFileName(basename(file.path))
  )
}

export function getProjectMemoryPathForSelector(
  existingMemoryFiles: MemoryFileInfo[],
  cwd: string,
): string {
  const loadedProjectInstructionPaths = new Set(
    existingMemoryFiles
      .filter(isLoadedProjectInstructionFile)
      .map(file => file.path),
  )

  return (
    findProjectInstructionFilePathInAncestors(
      cwd,
      path => loadedProjectInstructionPaths.has(path),
    ) ?? joinWithInputSeparator(cwd, PRIMARY_PROJECT_INSTRUCTION_FILE)
  )
}
