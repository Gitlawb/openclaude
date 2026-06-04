import type { NpmDistTags } from '../utils/autoUpdater.js'
import type { DiagnosticInfo } from '../utils/doctorDiagnostic.js'

export type DoctorDistTagsDependencies = {
  getDoctorDiagnostic: () => Promise<{
    installationType: DiagnosticInfo['installationType']
  }>
  getNpmDistTags: () => Promise<NpmDistTags>
  getGcsDistTags: () => Promise<NpmDistTags>
}

const FAILED_DIST_TAGS: NpmDistTags = {
  latest: null,
  stable: null,
}

export async function resolveDoctorDistTags(
  deps: DoctorDistTagsDependencies,
): Promise<NpmDistTags> {
  try {
    const diag = await deps.getDoctorDiagnostic()
    const fetchDistTags =
      diag.installationType === 'native'
        ? deps.getGcsDistTags
        : deps.getNpmDistTags

    return await fetchDistTags()
  } catch {
    return FAILED_DIST_TAGS
  }
}
