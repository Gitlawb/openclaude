import { expect, test } from 'bun:test'
import { __test } from './index.js'

const { detectLanguage } = __test

test('detectLanguage returns css for constructor.css (no prototype-chain crash)', () => {
  expect(detectLanguage('constructor.css', 'body {}')).toBe('css')
})

test('detectLanguage returns js for toString.js (no prototype-chain crash)', () => {
  expect(detectLanguage('toString.js', 'console.log()')).toBe('js')
})

test('detectLanguage returns correct lang for normal filenames', () => {
  expect(detectLanguage('app.ts', 'const x = 1')).toBe('ts')
  expect(detectLanguage('Dockerfile', 'FROM node:20')).toBe('dockerfile')
  expect(detectLanguage('Makefile', 'all: build')).toBe('makefile')
})
