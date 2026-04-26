/*
Recovered module wrapper
Original path: src/tools/read-directory/types.ts
Init symbol: tS
Statement range: 472672-476073
Wrapper range: 475523-476072
Approximate segment: ../../../../segments/0151__src-tools-edit-file-formatter.ts.mjs
Resolved init dependencies:
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/read-directory/types.ts"(){Ht(),Jw=f.object({path:f.string().describe("The absolute path to the directory to read"),exclude:f.array(f.string()).optional().describe("Optional array of glob patterns to exclude"),respectGitIgnore:f.boolean().optional().describe("Whether to respect .gitignore patterns (default: true)")}),f.object({files:f.array(f.string()),directories:f.array(f.string())}),Xw=class extends Error{static{__name(this,"DirectoryReadError")}code;constructor(e,t){super(e),this.name="DirectoryReadError",this.code=t}}}})
