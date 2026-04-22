#!/usr/bin/env node
/**
 * Post-build patch script for DuckHive.
 * Applies runtime fixes to the bundled cli.mjs that can't be fixed at source level.
 * Run automatically after `bun run build`.
 */
import { readFileSync, writeFileSync } from 'fs'

const file = 'dist/cli.mjs'
let content = readFileSync(file, 'utf8')
let patches = 0

// Patch 1: isZ4Schema - guard against undefined/null input
const isZ4SchemaOld = `function isZ4Schema(s) {
  const schema = s;
  return !!schema._zod;
}`
const isZ4SchemaNew = `function isZ4Schema(s) {
  const schema = s;
  if (!schema || typeof schema !== 'object') return false;
  return !!schema._zod;
}`
if (content.includes(isZ4SchemaOld)) {
    content = content.replace(isZ4SchemaOld, isZ4SchemaNew)
    patches++
    console.log('✓ Patched isZ4Schema')
}

// Patch 2: toJSONSchema - guard against non-object input
const toJSONOld = `function toJSONSchema(input, _params) {
  if (input instanceof $ZodRegistry) {`
const toJSONNew = `function toJSONSchema(input, _params) {
  if (!input || typeof input !== 'object') { return null; }
  if (input instanceof $ZodRegistry) {`
if (content.includes(toJSONOld)) {
    content = content.replace(toJSONOld, toJSONNew)
    patches++
    console.log('✓ Patched toJSONSchema')
}

// Patch 3: JSONSchemaGenerator.process - guard against missing _zod
const procOld = `    const def = schema._zod.def;`
const procNew = `    if (!schema || typeof schema !== 'object' || !('_zod' in schema)) { return; }
    const def = schema._zod.def;`
if (content.includes(procOld)) {
    content = content.replace(procOld, procNew)
    patches++
    console.log('✓ Patched JSONSchemaGenerator.process')
}

writeFileSync(file, content)
console.log(`Post-build patch: ${patches} patches applied`)
