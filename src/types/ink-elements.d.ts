/**
 * Augment React's JSX.IntrinsicElements with custom ink elements.
 * These are native terminal UI elements rendered by the ink framework.
 * With jsx: "react-jsx", TypeScript resolves JSX.IntrinsicElements from
 * the react module, so we must augment that namespace rather than the
 * global JSX namespace.
 */
import type {} from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': any
      'ink-text': any
    }
  }
}
