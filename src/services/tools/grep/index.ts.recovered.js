/*
Recovered module wrapper
Original path: src/tools/grep/index.ts
Init symbol: $S
Statement range: 496209-499588
Wrapper range: 496321-499329
Approximate segment: ../../../../segments/0160__src-tools-grep-formatter.ts.mjs
Resolved init dependencies:
- src/utils/tokens.ts
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js
- src/tools/grep/formatter.ts
- src/tools/grep/grep.ts
- src/tools/grep/types.ts

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/grep/index.ts"(){Ht(),xS(),PS(),MS(),AS(),IS={name:"grep",description:"Searches for text patterns across files in a directory using regular expressions, providing powerful pattern matching capabilities for code analysis, debugging, and content discovery.\nThis tool performs recursive searches through directory structures, examining file contents to find all occurrences of the specified pattern, making it ideal for locating specific code implementations, finding TODO comments, searching for function usage, or identifying configuration values.\nThe search uses Perl-compatible regular expressions (PCRE), supporting advanced patterns including lookaheads, lookbehinds, character classes, and quantifiers, with results showing file paths and line numbers for each match.\nFile filtering can be applied using glob patterns to search only specific file types, improving performance and relevance by focusing on the files that matter for your search.\nIt should be used when you need to find where something is defined or used in a codebase, locate specific text patterns across multiple files, verify the presence of certain code patterns, or analyze code structure and dependencies.",input_schema:{type:"object",properties:{pattern:{type:"string",description:'The regular expression pattern to search for in file contents. Supports full PCRE syntax including special characters (\\d, \\w, \\s), quantifiers (*, +, ?, {n,m}), anchors (^, $), and groups. Special regex characters like ., *, [, ], (, ), {, }, |, \\, ^, $ must be escaped with backslash when matching literally. Examples: "TODO.*urgent" finds TODO comments marked urgent, "function\\s+\\w+\\(" finds function definitions, "import.*from.*react" finds React imports.'},include:{type:"array",items:{type:"string"},description:'Optional array of glob patterns to filter which files to search. Only files matching at least one pattern will be searched. Supports standard glob syntax: * matches any characters except /, ** matches any characters including /, ? matches single character, [abc] matches character set. Examples: ["*.ts", "*.tsx"] searches TypeScript files, ["src/**/*.js"] searches JavaScript files in src directory, ["*.{js,jsx,ts,tsx}"] searches all JavaScript/TypeScript files. If omitted, searches all files except those in .gitignore.'},directory:{type:"string",description:'Optional directory to search in, specified as a relative path from the current working directory. Cannot be an absolute path. Examples: "src" searches in src folder, "packages/core" searches in packages/core, "." or omitted searches current directory. The directory must exist and be readable. Defaults to the current working directory if not specified.'}},required:["pattern"]},execute:__name(async e=>{try{const t=SS.parse(e);return formatGrepResults(await grepSearchInDirectory(t))}catch(e){return e instanceof Error?e.message===kS?e.message:`ERROR: ${e.message}`:"ERROR: Unknown error occurred while searching files"}},"execute")}}})
