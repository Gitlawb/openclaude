import { beforeEach, expect, mock, test } from 'bun:test'

import { loadDoctorDiagnostic } from './doctorDiagnosticLoad.js'
import type { DiagnosticInfo } from '../utils/doctorDiagnostic.js'

const diagnostic: DiagnosticInfo = {
  installationType: 'npm-global',
  version: '1.2.3',
  installationPath: '/usr/local/bin/openclaude',
  invokedBinary: '/usr/local/bin/openclaude',
  configInstallMethod: 'not set',
  autoUpdates: 'enabled',
  hasUpdatePermissions: null,
  multipleInstallations: [],
  warnings: [],
  ripgrepStatus: {
    working: true,
    mode: 'system',
    systemPath: '/usr/bin/rg',
  },
}

const getDoctorDiagnostic = mock(async (): Promise<DiagnosticInfo> => diagnostic)
const setDiagnostic = mock((_diagnostic: DiagnosticInfo) => {})
const setDiagnosticLoadFailed = mock((_failed: boolean) => {})

beforeEach(() => {
  getDoctorDiagnostic.mockClear()
  setDiagnostic.mockClear()
  setDiagnosticLoadFailed.mockClear()
  getDoctorDiagnostic.mockImplementation(async () => diagnostic)
})

test('stores diagnostics and clears the failed state after a successful load', async () => {
  await loadDoctorDiagnostic(
    { getDoctorDiagnostic },
    { setDiagnostic, setDiagnosticLoadFailed },
  )

  expect(setDiagnostic).toHaveBeenCalledTimes(1)
  expect(setDiagnostic).toHaveBeenCalledWith(diagnostic)
  expect(setDiagnosticLoadFailed).toHaveBeenCalledTimes(1)
  expect(setDiagnosticLoadFailed).toHaveBeenCalledWith(false)
})

test('marks diagnostic loading as failed when the diagnostic request rejects', async () => {
  getDoctorDiagnostic.mockImplementation(async () => {
    throw new Error('diagnostic unavailable')
  })

  await loadDoctorDiagnostic(
    { getDoctorDiagnostic },
    { setDiagnostic, setDiagnosticLoadFailed },
  )

  expect(setDiagnostic).not.toHaveBeenCalled()
  expect(setDiagnosticLoadFailed).toHaveBeenCalledTimes(1)
  expect(setDiagnosticLoadFailed).toHaveBeenCalledWith(true)
})
