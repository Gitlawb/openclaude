// React's cjs/react-jsx-dev-runtime.production.js deliberately exports
// `jsxDEV: undefined` — production bundles are expected to compile JSX with
// the non-dev transform. Our CLI build runs Bun's transpiler without
// NODE_ENV=production, so every JSX callsite compiles to a jsxDEV() call.
// Mapping the specifier straight to React's production file therefore left
// the whole UI invoking undefined() and nothing past the startup banner ever
// rendered. Implement jsxDEV in terms of the production jsx/jsxs instead —
// the same dispatch React's own dev runtime performs, minus dev-only
// validation. The extra dev-transform args (source, self) are ignorable.
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'

export { Fragment }

export function jsxDEV(type, config, maybeKey, isStaticChildren) {
  return isStaticChildren
    ? jsxs(type, config, maybeKey)
    : jsx(type, config, maybeKey)
}
