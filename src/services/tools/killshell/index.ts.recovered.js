/*
Recovered module wrapper
Original path: src/tools/killshell/index.ts
Init symbol: Ib
Statement range: 521612-533698
Wrapper range: 521788-522866
Approximate segment: ../../../../segments/0171__src-tools-killshell-formatter.ts.mjs
Resolved init dependencies:
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js
- src/tools/killshell/formatter.ts
- src/tools/killshell/types.ts
- src/tools/killshell/killshell.ts

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/killshell/index.ts"(){Ht(),ab(),lb(),Pb(),cb={name:"kill_shell",description:"Terminates processes by port number or PID, useful for freeing occupied ports or stopping stuck development servers. Attempts graceful termination first (SIGTERM/taskkill), then forces if needed. Use with caution - terminating system processes may cause instability.",acceptsCallbacks:!0,input_schema:{type:"object",properties:{port:{type:"number",description:"Port number (1-65535) to free by terminating the listening process. Automatically finds and kills the process using this port."},pid:{type:"number",description:"Process ID to terminate directly. Use when you know the exact PID to kill."}},required:[]},execute:__name(async(e,t)=>{try{const n=rb.parse(e);return t?.onPermissionRequest&&!await t.onPermissionRequest("kill_shell",e)?"ERROR: Permission denied — Process termination was not approved":formatKillshellResult(await executeKillshell(n))}catch(e){return e instanceof Error?`ERROR: ${e.message}`:"ERROR: Unknown error occurred while killing process"}},"execute")}}})
