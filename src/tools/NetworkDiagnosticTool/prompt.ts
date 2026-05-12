export const NETWORK_DIAGNOSTIC_TOOL_NAME = 'NetworkDiagnostic'
export const DESCRIPTION = 'Run network diagnostics including ping, DNS lookup, traceroute, port checking, and SSL certificate inspection.'
export const PROMPT = `Run network diagnostics and connectivity checks.

## Commands
- ping: ICMP echo to check host reachability and latency
- dns: DNS resolution (A, AAAA, MX, NS, TXT records)
- traceroute: Trace network path to host
- port-check: Check if a TCP port is open
- ssl-cert: Inspect SSL/TLS certificate (expiry, issuer, subject, SANs)
- http-status: Quick HTTP HEAD/GET to check endpoint status
- latency: Measure TCP connection latency to host:port

## Safety
- All operations are read-only
- Timeout prevents hanging (default: 15s per check)
- Only connects to specified targets
`
