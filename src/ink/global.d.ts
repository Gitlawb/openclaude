import type { ReactNode, Ref } from 'react'
import type { DOMElement } from './dom.js'
import type { ClickEvent } from './events/click-event.js'
import type { FocusEvent } from './events/focus-event.js'
import type { KeyboardEvent } from './events/keyboard-event.js'
import type { Styles, TextStyles } from './styles.js'

type InkBoxElementProps = {
  ref?: Ref<DOMElement>
  children?: ReactNode
  style?: Styles
  tabIndex?: number
  autoFocus?: boolean
  onClick?: (event: ClickEvent) => void
  onFocus?: (event: FocusEvent) => void
  onFocusCapture?: (event: FocusEvent) => void
  onBlur?: (event: FocusEvent) => void
  onBlurCapture?: (event: FocusEvent) => void
  onKeyDown?: (event: KeyboardEvent) => void
  onKeyDownCapture?: (event: KeyboardEvent) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  stickyScroll?: boolean
}

type InkTextElementProps = {
  children?: ReactNode
  style?: Styles
  textStyles?: TextStyles
}

type InkLinkElementProps = {
  children?: ReactNode
  href?: string
}

type InkRawAnsiElementProps = {
  rawText: string
  rawWidth: number
  rawHeight: number
}

type InkIntrinsicElements = {
  'ink-box': InkBoxElementProps
  'ink-text': InkTextElementProps
  'ink-root': Record<string, unknown>
  'ink-virtual-text': Record<string, unknown>
  'ink-link': InkLinkElementProps
  'ink-raw-ansi': InkRawAnsiElementProps
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends InkIntrinsicElements {}
  }
}
