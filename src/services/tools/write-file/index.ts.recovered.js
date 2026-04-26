/*
Recovered module wrapper
Original path: src/tools/write-file/index.ts
Init symbol: hS
Statement range: 481690-484800
Wrapper range: 481805-483824
Approximate segment: ../../../../segments/0155__src-tools-write-file-formatter.ts.mjs
Resolved init dependencies:
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js
- src/tools/write-file/types.ts
- src/tools/write-file/formatter.ts
- src/tools/write-file/write-file.ts

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/write-file/index.ts"(){Ht(),aS(),lS(),gS(),cS={name:"write_file",description:"Creates or overwrites a file with the specified content at the given absolute path, automatically creating any necessary parent directories.\nThis tool handles the complete file writing process, including directory creation, making it ideal for generating new files, saving processed output, or creating configuration files.\nIf the file already exists, it will be completely overwritten with the new content - the previous contents will be lost, so use with caution on existing files.\nThe tool automatically creates any missing parent directories in the path, eliminating the need to manually ensure directory structure exists before writing.\nIt should be used when you need to create new files, save generated content, write configuration files, or output processed data to the filesystem.\nAll content is written as UTF-8 encoded text, making it suitable for source code, configuration files, documentation, and other text-based formats.",input_schema:{type:"object",properties:{filePath:{type:"string",description:"The absolute path where the file should be written. Must be a complete path starting from the root directory (/ on Unix/Linux/macOS or C:\\ on Windows). If parent directories do not exist, they will be created automatically. Existing files at this path will be overwritten without warning."},content:{type:"string",description:"The text content to write to the file. Can be any UTF-8 string including multi-line text, JSON, XML, source code, or any other text format. Empty strings are valid and will create an empty file. Line endings are preserved as provided."}},required:["filePath","content"]},execute:__name(async e=>{try{const t=oS.parse(e),n=await writeFile2(t);return formatOutput4({success:!0,message:`Successfully wrote ${n.bytesWritten} bytes to file\n`,path:n.path})}catch(e){return formatOutput4({success:!1,message:e instanceof Error?e.message:"Unknown error occurred"})}},"execute")}}})
