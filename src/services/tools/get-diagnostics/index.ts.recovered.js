/*
Recovered module wrapper
Original path: src/tools/get-diagnostics/index.ts
Init symbol: Kb
Statement range: 535203-541988
Wrapper range: 535347-536438
Approximate segment: ../../../../segments/0173__src-tools-get-diagnostics-formatter.ts.mjs
Resolved init dependencies:
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js
- src/tools/get-diagnostics/types.ts
- src/tools/get-diagnostics/get-diagnostics.ts
- src/tools/get-diagnostics/formatter.ts

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/get-diagnostics/index.ts"(){Ht(),Lb(),Ob(),Qb(),Fb={name:"diagnostics",description:"Get LSP diagnostics (errors, warnings, hints) from the IDE. Returns type errors, lint warnings, and other language server diagnostics reported by all active language servers (TypeScript, ESLint, Python, etc.). Only available when connected to an IDE with the Command Code extension. Pass specific file paths when you know which files are relevant. Only omit filePaths to scan the entire workspace when the user explicitly asks for all workspace diagnostics.",input_schema:{type:"object",properties:{filePaths:{type:"array",items:{type:"string"},description:'Array of absolute file paths to get diagnostics for. MUST always be an array, even for a single file e.g. ["/path/to/file.ts"]. Pass specific file paths when you know which files are relevant. Only omit to scan the entire workspace when the user explicitly asks for all workspace diagnostics.'}},required:[]},execute:__name(async e=>{const t=hb.parse(e);return formatDiagnostics(await fetchDiagnostics(t.filePaths))},"execute")}}})
