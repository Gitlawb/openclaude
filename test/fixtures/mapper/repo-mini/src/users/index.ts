import { getConfig } from '../config/index.js'
import { authenticate } from '../auth/index.js'
export interface User { id: string; name: string }
export function getUser(id: string): User { return { id, name: 'test' } }
export const USER_ROLES = ['admin', 'user'] as const
