/*
Recovered module wrapper
Original path: src/tools/glob/index.ts
Init symbol: BS
Statement range: 500708-503758
Wrapper range: 500820-503100
Approximate segment: ../../../../segments/0162__src-tools-glob-formatter.ts.mjs
Resolved init dependencies:
- src/tools/glob/glob.ts
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js
- src/tools/glob/types.ts
- src/tools/glob/formatter.ts

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/glob/index.ts"(){Ht(),LS(),DS(),jS(),OS={name:"glob",description:"Searches for files in a directory tree using glob-style path patterns, enabling fast and flexible discovery of files across codebases of any size.\nThis tool matches file paths against glob patterns such as **/*.js or src/**/*.ts, making it ideal for locating files by name, extension, or directory structure without inspecting file contents. It performs recursive traversal where applicable and efficiently handles large repositories.\nResults are returned as a list of matching file paths, sorted by modification time, allowing you to quickly identify the most recently changed or relevant files.\nFile pattern matching can be refined using inclusive or exclusive glob expressions to narrow down results, improving performance and focus when working with large or complex projects.\nIt should be used when you need to find files based on naming or path patterns, explore the structure of an unfamiliar codebase, locate configuration or entry-point files, or prepare a targeted set of files for further inspection with tools like grep.",input_schema:{type:"object",properties:{pattern:{type:"string",description:'Glob pattern to match files. Supports wildcards: * matches any characters except /, ** matches any characters including / (for recursive search), ? matches single character, [abc] matches character set, {js,ts} matches alternatives. Examples: "**/*.ts" finds all TypeScript files recursively, "src/**/*.{js,jsx}" finds JavaScript files in src directory, "*.json" finds JSON files in current directory, "**/test/**/*.spec.ts" finds test spec files.'},path:{type:"string",description:'Optional directory to search in, specified as a relative path from the current working directory. Cannot be an absolute path. Examples: "src" searches in src folder, "packages/core" searches in packages/core, "." or omitted searches current directory. The directory must exist and be readable. Defaults to the current working directory if not specified.'}},required:["pattern"]},execute:__name(async e=>{try{const t=NS.parse(e);return formatGlobResults(await globSearch(t))}catch(e){return e instanceof Error?`ERROR: ${e.message}`:"ERROR: Unknown error occurred while finding files"}},"execute")}}})
