import { beforeEach, expect, mock, test } from 'bun:test'

import {
  resolveDoctorDistTags,
  type DoctorDistTagsDependencies,
} from './doctorDistTags.js'
import type { NpmDistTags } from '../utils/autoUpdater.js'
import type { DiagnosticInfo } from '../utils/doctorDiagnostic.js'

const getDoctorDiagnostic = mock(
  async (): Promise<{ installationType: DiagnosticInfo['installationType'] }> =>
    ({ installationType: 'npm-global' }),
)
const getNpmDistTags = mock(async (): Promise<NpmDistTags> => ({
  latest: '9.9.9',
  stable: '8.8.8',
}))
const getGcsDistTags = mock(async (): Promise<NpmDistTags> => ({
  latest: '7.7.7',
  stable: '6.6.6',
}))

const deps: DoctorDistTagsDependencies = {
  getDoctorDiagnostic,
  getNpmDistTags,
  getGcsDistTags,
}

beforeEach(() => {
  getDoctorDiagnostic.mockClear()
  getNpmDistTags.mockClear()
  getGcsDistTags.mockClear()
  getDoctorDiagnostic.mockImplementation(async () => ({
    installationType: 'npm-global',
  }))
  getNpmDistTags.mockImplementation(async () => ({
    latest: '9.9.9',
    stable: '8.8.8',
  }))
  getGcsDistTags.mockImplementation(async () => ({
    latest: '7.7.7',
    stable: '6.6.6',
  }))
})

test('uses npm dist tags for npm installations', async () => {
  const distTags = await resolveDoctorDistTags(deps)

  expect(distTags).toEqual({ latest: '9.9.9', stable: '8.8.8' })
  expect(getNpmDistTags).toHaveBeenCalledTimes(1)
  expect(getGcsDistTags).not.toHaveBeenCalled()
})

test('uses GCS dist tags for native installations', async () => {
  getDoctorDiagnostic.mockImplementation(async () => ({
    installationType: 'native',
  }))

  const distTags = await resolveDoctorDistTags(deps)

  expect(distTags).toEqual({ latest: '7.7.7', stable: '6.6.6' })
  expect(getGcsDistTags).toHaveBeenCalledTimes(1)
  expect(getNpmDistTags).not.toHaveBeenCalled()
})

test('falls back to empty dist tags when the selected version source fails', async () => {
  getNpmDistTags.mockImplementation(async () => {
    throw new Error('registry unavailable')
  })

  const distTags = await resolveDoctorDistTags(deps)

  expect(distTags).toEqual({ latest: null, stable: null })
  expect(getNpmDistTags).toHaveBeenCalledTimes(1)
  expect(getGcsDistTags).not.toHaveBeenCalled()
})

test('falls back to empty dist tags when diagnostics fail before choosing a version source', async () => {
  getDoctorDiagnostic.mockImplementation(async () => {
    throw new Error('diagnostic unavailable')
  })

  const distTags = await resolveDoctorDistTags(deps)

  expect(distTags).toEqual({ latest: null, stable: null })
  expect(getNpmDistTags).not.toHaveBeenCalled()
  expect(getGcsDistTags).not.toHaveBeenCalled()
})
