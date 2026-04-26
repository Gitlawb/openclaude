/*
Recovered module wrapper
Original path: src/tools/exit-plan-mode/index.ts
Init symbol: Nb
Statement range: 521612-533698
Wrapper range: 522870-524591
Approximate segment: ../../../../segments/0171__src-tools-killshell-formatter.ts.mjs
Resolved init dependencies:
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/exit-plan-mode/index.ts"(){Ht(),ub={name:"exit_plan_mode",description:'Call this tool when your plan is complete and ready for user approval.\n\nThis will:\n1. Ask the user if they want to exit plan mode and begin implementation\n2. If user says "Yes": Exit plan mode and begin implementation\n3. If user says "No": Stay in plan mode for further refinement\n\nUsage:\n- Call this AFTER writing the plan file\n- Call this AFTER asking any clarifying questions\n- This is the FINAL step in plan mode\n\nIMPORTANT: Call this tool ALONE — do not combine it with other tool calls in the same message. It switches your mode and system prompt.\n\nDO NOT:\n- Call this before the plan is written\n- Call this multiple times\n- Ask "Ready to implement?" yourself - this tool does that',acceptsCallbacks:!0,input_schema:{type:"object",properties:{},required:[]},execute:__name(async(e,t)=>{if(!t?.onQuestionRequest)return JSON.stringify({error:"Question callback not available"});const n=await t.onQuestionRequest({questions:[{question:"Exit plan mode and begin implementation?",header:"Exit Plan",options:[{label:"Yes, auto-accept",description:"Exit plan mode and implement with auto-accept (no permission prompts)"},{label:"Yes, exit",description:"Exit plan mode and implement with manual approval for each change"},{label:"Cancel",description:"Stay in plan mode to refine the plan further"}],multiSelect:!1}],hideCustomInput:!0,exitPlanMode:!0}),r=n?.answers?.[0]?.selectedOptions?.[0]||"";return r.startsWith("Yes, auto-accept")?"Exited plan mode. Now in auto-accept mode.":r.startsWith("Yes, exit")?"Exited plan mode. Now in standard mode.":"Staying in plan mode. Continue refining the plan."},"execute")}}})
