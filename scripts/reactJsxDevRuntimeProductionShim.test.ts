import { describe, expect, test } from 'bun:test'
// eslint-disable-next-line no-restricted-imports -- comparing shim output against the real runtime is the point
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import {
  Fragment as ShimFragment,
  jsxDEV,
} from './reactJsxDevRuntimeProductionShim.js'

// The CLI bundle compiles every JSX callsite to jsxDEV() (Bun's dev
// transform) but bundles production React, whose jsx-dev-runtime exports
// `jsxDEV: undefined` — that combination rendered the entire TUI blank with
// no error (see the shim's header comment). These tests pin the shim's
// dispatch so a future edit can't silently reintroduce that failure.
describe('reactJsxDevRuntimeProductionShim', () => {
  test('jsxDEV is a function (the whole reason the shim exists)', () => {
    expect(typeof jsxDEV).toBe('function')
  })

  test('re-exports the real Fragment', () => {
    expect(ShimFragment).toBe(Fragment)
  })

  test('routes to jsx() when isStaticChildren is false', () => {
    const props = { className: 'a', children: 'hi' }
    expect(jsxDEV('div', props, 'k', false)).toEqual(jsx('div', props, 'k'))
  })

  test('routes to jsxs() when isStaticChildren is true', () => {
    const children = ['one', 'two']
    const props = { children }
    expect(jsxDEV('div', props, undefined, true)).toEqual(
      jsxs('div', props, undefined),
    )
  })

  test('returns the expected element shape for a trivial element', () => {
    const el = jsxDEV('span', { children: 'x' }, 'key1', false)
    expect(el.$$typeof).toBe(Symbol.for('react.transitional.element'))
    expect(el.type).toBe('span')
    expect(el.key).toBe('key1')
    expect(el.props).toEqual({ children: 'x' })
  })
})
