/*
Recovered module wrapper
Original path: src/tools/ask-user-question/index.ts
Init symbol: ib
Statement range: 514649-517635
Wrapper range: 514807-517084
Approximate segment: ../../../../segments/0169__src-tools-ask-user-question-formatter.ts.mjs
Resolved init dependencies:
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js
- src/tools/ask-user-question/formatter.ts
- src/tools/ask-user-question/ask-user-question.ts

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/ask-user-question/index.ts"(){Ht(),tb(),sb(),sb(),nb={name:"ask_user_question",description:'Use this tool when you need to ask the user questions during execution. This allows you to:\n1. Gather user preferences or requirements\n2. Clarify ambiguous instructions\n3. Get decisions on implementation choices as you work\n4. Offer choices to the user about what direction to take.\n\nUsage notes:\n- Users will always be able to select "Type something" to provide custom text input\n- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label\n- Use multiSelect: true to allow multiple answers to be selected for a question',acceptsCallbacks:!0,input_schema:{type:"object",properties:{questions:{type:"array",description:"Questions to ask the user",items:{type:"object",properties:{question:{type:"string",description:"The complete question to ask the user. Should be clear, specific, and end with a question mark."},header:{type:"string",description:'Very short label displayed as a chip/tag (max 20 chars). Examples: "Auth method", "Library", "Approach".'},options:{type:"array",description:'The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). There should be no "Type something" option, that will be provided automatically.',items:{type:"object",properties:{label:{type:"string",description:"The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice."},description:{type:"string",description:"Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications."}},required:["label","description"]}},multiSelect:{type:"boolean",description:"Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive."}},required:["question","header","options"]}}},required:["questions"]},execute:__name(async(e,t)=>{const n=await askUserQuestion(e,{onQuestionRequest:t?.onQuestionRequest,abortSignal:t?.abortSignal});try{return formatOutput6({result:JSON.parse(n),params:e})}catch{return n}},"execute")}}})
