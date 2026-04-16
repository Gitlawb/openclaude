import { getConfig } from '../config/index.js'
export function log(msg: string) { console.log(msg) }
export function formatDate(d: Date): string { return d.toISOString() }
export function hash(input: string): string { return input }
