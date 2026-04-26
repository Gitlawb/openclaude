/*
Recovered module wrapper
Original path: src/tools/read-directory/index.ts
Init symbol: iS
Statement range: 478617-481008
Wrapper range: 478727-480715
Approximate segment: ../../../../segments/0153__src-tools-read-directory-formatter.ts.mjs
Resolved init dependencies:
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js
- src/tools/read-directory/read-directory.ts
- src/tools/read-directory/formatter.ts
- src/tools/read-directory/types.ts

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/read-directory/index.ts"(){Ht(),tS(),nS(),sS(),rS={name:"read_directory",description:"Lists the contents of a directory, providing separate arrays of files and subdirectories found at the specified path.\nThis tool is essential for exploring project structure, discovering available files, and understanding directory organization before performing operations on specific files.\nIt automatically respects .gitignore patterns by default when operating within git repositories, ensuring you don't see files that are intentionally excluded from version control.\nThe tool supports custom exclusion patterns using glob syntax, allowing you to filter out specific files or directories based on your needs, such as build artifacts or temporary files.\nResults are always sorted alphabetically for consistent output, making it easier to locate specific items in large directories.\nIt should be used when you need to explore a directory's contents, verify file existence, or understand project structure before performing file operations.",input_schema:{type:"object",properties:{path:{type:"string",description:"The absolute path to the directory to read. Must be a complete path starting from the root directory (/ on Unix/Linux/macOS or C:\\ on Windows). The directory must exist and be accessible. Returns an error if the path points to a file instead of a directory."},exclude:{type:"array",items:{type:"string"},description:'Optional array of glob patterns to exclude from results. Uses minimatch syntax for pattern matching. Examples: ["*.log", "temp*", "**/*.tmp"] would exclude all log files, anything starting with "temp", and all .tmp files in any subdirectory. Patterns are applied in addition to any .gitignore rules.'}},required:["path"]},execute:__name(async e=>{try{const t=Jw.parse(e);return formatOutput3(await readDirectory(t))}catch(e){return e instanceof Error?`ERROR: ${e.message}`:"ERROR: Unknown error occurred while reading directory"}},"execute")}}})
