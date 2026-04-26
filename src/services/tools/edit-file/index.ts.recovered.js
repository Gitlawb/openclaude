/*
Recovered module wrapper
Original path: src/tools/edit-file/index.ts
Init symbol: eS
Statement range: 472672-476073
Wrapper range: 472780-475519
Approximate segment: ../../../../segments/0151__src-tools-edit-file-formatter.ts.mjs
Resolved init dependencies:
- src/tools/edit-file/types.ts
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js
- src/tools/edit-file/edit-file.ts
- src/tools/edit-file/formatter.ts

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/edit-file/index.ts"(){Ht(),Fw(),Kw(),Zw(),Yw={name:"edit_file",description:"Performs precise text replacements in files by finding and replacing exact string matches, similar to a str_replace operation.\nThis tool is designed for making targeted edits to text files, allowing you to replace specific occurrences of text with new content while preserving the rest of the file unchanged.\nIt validates that the file exists, is accessible, and is a text file (not binary) before attempting any modifications, ensuring data integrity.\nThe tool can replace a single occurrence, a specific number of occurrences, or all occurrences of the target text based on your requirements.\nIt should be used when you need to fix typos, update variable names, modify configuration values, or make any other precise text changes in code or text files.\nThe tool will report the exact number of replacements made and will fail safely if the target text is not found or if multiple matches exist when expecting a unique match.",input_schema:{type:"object",properties:{filePath:{type:"string",description:"The absolute path to the file to edit. Must be a complete path starting from the root directory (/ on Unix/Linux/macOS or C:\\ on Windows). The file must exist and have write permissions. Binary files cannot be edited with this tool."},oldValue:{type:"string",description:"The exact text string to search for in the file. This must match exactly including whitespace, indentation, and line breaks. The match is case-sensitive. If multiple matches exist and replaceAll is false, only the first occurrence from the beginning of the file will be replaced."},newValue:{type:"string",description:"The replacement text that will be inserted in place of each matched occurrence of oldValue. Can be an empty string to effectively delete the matched text. Preserves any surrounding whitespace and formatting."},replaceAll:{type:"boolean",description:"When true, replaces all occurrences of oldValue in the file. When false (default), replaces only the number of occurrences specified by replacementCount. Use true when you need to update all instances, such as renaming a variable throughout a file."},replacementCount:{type:"number",description:"The number of occurrences to replace when replaceAll is false. Default is 1. Must be a positive integer. If set higher than the actual number of occurrences, the tool will report an error. Use this for controlled, partial replacements."}},required:["filePath","oldValue","newValue"]},execute:__name(async e=>{try{const t=Rw.parse(e);return formatOutput2(await editFile(t))}catch(e){return e instanceof Error?`ERROR: ${e.message}`:"ERROR: Unknown error occurred while editing file"}},"execute")}}})
