/*
Recovered module wrapper
Original path: src/tools/shell-command/types.ts
Init symbol: US
Statement range: 500708-503758
Wrapper range: 503104-503757
Approximate segment: ../../../../segments/0162__src-tools-glob-formatter.ts.mjs
Resolved init dependencies:
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/shell-command/types.ts"(){Ht(),FS=f.object({command:f.string().min(1,"Command cannot be empty"),args:f.preprocess(e=>{if("string"==typeof e){try{const t=JSON.parse(e);if(Array.isArray(t))return t}catch{}return[e]}return e},f.array(f.string()).optional()),directory:f.string().optional(),timeout:f.preprocess(e=>"string"==typeof e?parseInt(e,10):e,f.number().optional())}),qS=class extends Error{static{__name(this,"ShellCommandError")}code;exitCode;signal;stdout;stderr;duration;constructor(e,t,n,r,o,s,i){super(e),this.name="ShellCommandError",this.code=t,this.exitCode=n,this.signal=r,this.stdout=o,this.stderr=s,this.duration=i}}}})
