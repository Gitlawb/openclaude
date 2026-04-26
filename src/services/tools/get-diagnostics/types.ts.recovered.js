/*
Recovered module wrapper
Original path: src/tools/get-diagnostics/types.ts
Init symbol: Lb
Statement range: 521612-533698
Wrapper range: 526654-527195
Approximate segment: ../../../../segments/0171__src-tools-killshell-formatter.ts.mjs
Resolved init dependencies:
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/get-diagnostics/types.ts"(){Ht(),gb=f.preprocess(e=>{if("string"==typeof e)try{const t=JSON.parse(e);if(Array.isArray(t))return t}catch{return[e]}return e},f.array(f.string()).optional()),hb=f.object({filePaths:gb.describe('Array of absolute file paths to get diagnostics for. MUST always be an array, even for a single file e.g. ["/path/to/file.ts"]. Pass specific file paths when you know which files are relevant. Only omit to scan the entire workspace when the user explicitly asks for all workspace diagnostics.')})}})
