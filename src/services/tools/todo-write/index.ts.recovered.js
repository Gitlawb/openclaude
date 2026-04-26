/*
Recovered module wrapper
Original path: src/tools/todo-write/index.ts
Init symbol: eb
Statement range: 511514-512381
Wrapper range: 511611-512380
Approximate segment: ../../../../segments/0167__src-tools-todo-write-todo-write.ts.mjs
Resolved init dependencies:
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js
- src/tools/todo-write/todo-write.ts

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/todo-write/index.ts"(){Ht(),ZS(),XS={name:"todo_write",description:"Create and manage a structured task list. Use this to track progress, organize complex tasks, and show thoroughness to the user. Create todos when tasks require multiple steps, are non-trivial, or when explicitly requested.",input_schema:{type:"object",properties:{todos:{type:"array",description:"The updated todo list",items:{type:"object",properties:{content:{type:"string",minLength:1,description:"The todo item content"},status:{type:"string",enum:["pending","in_progress","completed"],description:"The status of the todo item"},id:{type:"string",description:"Unique identifier for the todo item"}},required:["content","status","id"]}}},required:["todos"]},execute:todoWrite}}})
