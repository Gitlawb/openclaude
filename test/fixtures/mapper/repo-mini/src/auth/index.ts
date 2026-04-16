import { User } from '../users/index.js'
import { getConfig } from '../config/index.js'
export function authenticate(token: string): User | null { return null }
export function authorize(user: User, role: string): boolean { return false }
export default authenticate
