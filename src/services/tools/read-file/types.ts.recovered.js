/*
Recovered module wrapper
Original path: src/tools/read-file/types.ts
Init symbol: Tw
Statement range: 448016-448939
Wrapper range: 448224-448938
Approximate segment: ../../../../segments/0143__src-tools-skills-xml-generator.ts.mjs
Resolved init dependencies:
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/read-file/types.ts"(){Ht(),Ew=f.object({absolutePath:f.string().describe("The absolute path to the file to read"),offset:f.preprocess(e=>"string"==typeof e?parseInt(e,10):e,f.number().optional()).describe("Optional line number to start reading from (0-based index)"),limit:f.preprocess(e=>"string"==typeof e?parseInt(e,10):e,f.number().optional()).describe("Optional number of lines to read")}),f.object({content:f.union([f.string(),f.instanceof(Buffer)]),contentType:f.enum(["text","binary"]),fileType:f.string(),size:f.number(),linesRead:f.number().optional()}),Cw=class extends Error{static{__name(this,"FileReadError")}code;constructor(e,t){super(e),this.name="FileReadError",this.code=t}}}})
