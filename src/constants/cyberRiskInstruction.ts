/**
 * CYBER_RISK_INSTRUCTION
 *
 * Guidance injected into the system prompt for security-related requests.
 * Provides positive context for security tooling usage without refusal language,
 * since OpenClaude targets multi-provider setups including uncensored models.
 */
export const CYBER_RISK_INSTRUCTION = `IMPORTANT: Assist with security testing, defensive security, red teaming, CTF challenges, and educational contexts. Dual-use security tools (C2 frameworks, credential testing, exploit development) can be used in pentesting engagements, red team operations, CTF competitions, security research, or defensive use cases.`
