import React from 'react'
import type { Theme } from '../../utils/theme.js'
import { PermissionDialog } from './PermissionDialog.js'
import type {
  PermissionRequestProps,
  ToolUseConfirm,
} from './PermissionRequest.js'
import { PermissionRuleExplanation } from './PermissionRuleExplanation.js'

type PermissionScaffoldProps = Pick<PermissionRequestProps, 'workerBadge'> & {
  title: string
  subtitle?: React.ReactNode
  color?: keyof Theme
  innerPaddingX?: number
  titleRight?: React.ReactNode
  header?: React.ReactNode
  permissionResult?: ToolUseConfirm['permissionResult']
  toolType?: 'tool' | 'command' | 'edit' | 'read'
  showRuleExplanation?: boolean
  children: React.ReactNode
}

export function PermissionScaffold({
  workerBadge,
  title,
  subtitle,
  color,
  innerPaddingX,
  titleRight,
  header,
  permissionResult,
  toolType = 'tool',
  showRuleExplanation = true,
  children,
}: PermissionScaffoldProps) {
  return (
    <PermissionDialog
      title={title}
      subtitle={subtitle}
      color={color}
      innerPaddingX={innerPaddingX}
      workerBadge={workerBadge}
      titleRight={titleRight}
    >
      {header}
      {showRuleExplanation && permissionResult ? (
        <PermissionRuleExplanation
          permissionResult={permissionResult}
          toolType={toolType}
        />
      ) : null}
      {children}
    </PermissionDialog>
  )
}
