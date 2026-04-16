import fs from 'node:fs'
import { z } from 'zod'
export const x = fs.readFileSync
export const schema = z.string()
