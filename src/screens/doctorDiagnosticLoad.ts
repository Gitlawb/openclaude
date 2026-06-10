import type { DiagnosticInfo } from '../utils/doctorDiagnostic.js'

export type DoctorDiagnosticLoadDependencies = {
  getDoctorDiagnostic: () => Promise<DiagnosticInfo>
}

export type DoctorDiagnosticLoadHandlers = {
  setDiagnostic: (diagnostic: DiagnosticInfo) => void
  setDiagnosticLoadFailed: (failed: boolean) => void
}

export async function loadDoctorDiagnostic(
  deps: DoctorDiagnosticLoadDependencies,
  handlers: DoctorDiagnosticLoadHandlers,
): Promise<void> {
  try {
    const diagnostic = await deps.getDoctorDiagnostic()
    handlers.setDiagnostic(diagnostic)
    handlers.setDiagnosticLoadFailed(false)
  } catch {
    handlers.setDiagnosticLoadFailed(true)
  }
}
