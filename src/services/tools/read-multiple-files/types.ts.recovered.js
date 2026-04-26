/*
Recovered module wrapper
Original path: src/tools/read-multiple-files/types.ts
Init symbol: fS
Statement range: 481690-484800
Wrapper range: 483828-484799
Approximate segment: ../../../../segments/0155__src-tools-write-file-formatter.ts.mjs
Resolved init dependencies:
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/read-multiple-files/types.ts"(){Ht(),uS=f.object({include:f.array(f.string()).describe("Array of glob patterns to include files"),exclude:f.array(f.string()).optional().describe("Array of glob patterns to exclude files"),defaultExclude:f.boolean().optional().describe("Whether to apply default exclusions (node_modules, dist, etc.). Default: true"),gitIgnore:f.boolean().optional().describe("Whether to respect .gitignore files. Default: true"),targetDirectory:f.string().optional().describe("Base directory for relative paths. Default: current working directory")}),dS=f.object({filePath:f.string(),content:f.string(),fileType:f.string(),size:f.number()}),f.object({content:f.string(),filesRead:f.array(f.string()),errors:f.array(f.object({file:f.string(),error:f.string()})),fileDetails:f.array(dS)}),mS=class extends Error{static{__name(this,"MultipleFilesReadError")}code;constructor(e,t){super(e),this.name="MultipleFilesReadError",this.code=t}}}})
