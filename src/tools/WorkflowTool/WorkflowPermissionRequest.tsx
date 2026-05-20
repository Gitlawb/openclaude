import * as React from 'react'
import { FallbackPermissionRequest } from '../../components/permissions/FallbackPermissionRequest.js'
import type { PermissionRequestProps } from '../../components/permissions/PermissionRequest.js'

export function WorkflowPermissionRequest(
  props: PermissionRequestProps,
): React.ReactNode {
  return <FallbackPermissionRequest {...props} />
}
