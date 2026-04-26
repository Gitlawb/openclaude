/*
Recovered module wrapper
Original path: src/tools/killshell/types.ts
Init symbol: ab
Statement range: 514649-517635
Wrapper range: 517088-517634
Approximate segment: ../../../../segments/0169__src-tools-ask-user-question-formatter.ts.mjs
Resolved init dependencies:
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/killshell/types.ts"(){Ht(),rb=f.object({port:f.number().int().min(1,{message:"Port must be between 1 and 65535"}).max(65535,{message:"Port must be between 1 and 65535"}).optional(),pid:f.number().int().positive().optional()}).refine(e=>void 0!==e.port&&void 0===e.pid||void 0===e.port&&void 0!==e.pid,{message:"Exactly one of port or pid must be provided"}),ob=class extends Error{static{__name(this,"KillshellError")}code;pid;port;constructor(e,t,n,r){super(e),this.name="KillshellError",this.code=t,this.pid=n,this.port=r}}}})
