/*
Recovered module wrapper
Original path: src/tools/read-file/index.ts
Init symbol: Ow
Statement range: 453291-456778
Wrapper range: 453409-455457
Approximate segment: ../../../../segments/0147__src-tools-read-file-formatter.ts.mjs
Resolved init dependencies:
- src/tools/read-file/formatter.ts
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js
- src/tools/read-file/read-file.ts
- src/tools/read-file/types.ts

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/read-file/index.ts"(){Ht(),Tw(),Pw(),Dw(),Nw={name:"read_file",description:"Reads the contents of a file from the local filesystem, handling both text and binary files appropriately. \nThis tool automatically detects the file type based on extension and processes it accordingly - text files are returned as readable strings while binary files return metadata about the file type and size. \nFor large text files, you can optionally read specific line ranges using the offset and limit parameters to avoid loading the entire file into memory. \nThe tool validates that the provided path is absolute and that the file exists and is readable before attempting to read it. \nIt should be used when you need to examine file contents, verify file existence, or extract specific portions of text files for analysis or processing.",input_schema:{type:"object",properties:{absolutePath:{type:"string",description:'The absolute path to the file to read. Must be a complete path starting from the root directory (/ on Unix/Linux/macOS or C:\\ on Windows). Relative paths like "./file.txt" or "../file.txt" are not accepted. The file must exist and be readable by the current process.'},offset:{type:"number",description:"The line number to start reading from (0-based index, where 0 is the first line). This parameter must be used together with the limit parameter for reading specific line ranges. Cannot be negative. Use this when you need to read a specific section of a large file without loading the entire content."},limit:{type:"number",description:"The maximum number of lines to read starting from the offset. Must be a positive integer and used together with the offset parameter. This helps manage memory usage when dealing with large files by reading only the necessary portion."}},required:["absolutePath"]},execute:__name(async e=>{try{const t=Ew.parse(e);return formatOutput(await readFileContent(t))}catch(e){return e instanceof Error?`ERROR: ${e.message}`:"ERROR: Unknown error occurred while reading file"}},"execute")}}})
