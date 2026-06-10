import type React from 'react'

export type WizardStepComponent = React.ComponentType

export type WizardProviderProps<
  T extends Record<string, unknown> = Record<string, unknown>,
> = {
  steps: WizardStepComponent[]
  initialData?: T
  onComplete: (data: T) => void
  onCancel?: () => void
  children?: React.ReactNode
  title?: string
  showStepCounter?: boolean
}

export type WizardContextValue<
  T extends Record<string, unknown> = Record<string, unknown>,
> = {
  currentStepIndex: number
  totalSteps: number
  wizardData: T
  setWizardData: React.Dispatch<React.SetStateAction<T>>
  updateWizardData: (updates: Partial<T>) => void
  goNext: () => void
  goBack: () => void
  goToStep: (index: number) => void
  cancel: () => void
  title?: string
  showStepCounter: boolean
}
