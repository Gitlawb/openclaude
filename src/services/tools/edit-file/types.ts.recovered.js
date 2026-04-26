/*
Recovered module wrapper
Original path: src/tools/edit-file/types.ts
Init symbol: Fw
Statement range: 453291-456778
Wrapper range: 455461-456108
Approximate segment: ../../../../segments/0147__src-tools-read-file-formatter.ts.mjs
Resolved init dependencies:
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/edit-file/types.ts"(){Ht(),Rw=f.object({filePath:f.string().describe("The absolute path to the file to edit"),oldValue:f.string().describe("The text to replace"),newValue:f.string().describe("The new text to insert"),replacementCount:f.number().optional().describe("The number of replacements to make (default: 1, used only when replaceAll is false)"),replaceAll:f.boolean().optional().describe("Whether to replace all occurrences (default: false)")}),f.object({path:f.string(),replacementsCount:f.number(),oldContent:f.string(),newContent:f.string()}),f.object({name:f.string(),message:f.string(),code:f.string().optional()})}})
