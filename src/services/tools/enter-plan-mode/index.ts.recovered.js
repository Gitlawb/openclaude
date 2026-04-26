/*
Recovered module wrapper
Original path: src/tools/enter-plan-mode/index.ts
Init symbol: Rb
Statement range: 521612-533698
Wrapper range: 524595-526438
Approximate segment: ../../../../segments/0171__src-tools-killshell-formatter.ts.mjs
Resolved init dependencies:
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/enter-plan-mode/index.ts"(){Ht(),db={name:"enter_plan_mode",description:'Call this tool to enter plan mode for read-only exploration and structured planning.\n\nThis will:\n1. Ask the user if they want to enter plan mode\n2. If user says "Yes": Switch to plan mode (read-only exploration and planning)\n3. If user says "No": Stay in current mode\n\nWHEN TO CALL:\n- User explicitly asks to "plan", "design", or "explore"\n- Task requires understanding multiple files/systems you haven\'t read yet\n- Task involves architectural decisions or spans 3+ files\n- You need to research the codebase before you can implement effectively\n- You\'re unsure about the right approach\n\nIMPORTANT: Call this tool ALONE — do not combine it with other tool calls in the same message. It switches your mode and system prompt, so other tools in the same message would run under the wrong mode.\n\nDO NOT:\n- Call this if already in plan mode\n- Call this for simple, well-defined tasks where you know exactly what to do',acceptsCallbacks:!0,input_schema:{type:"object",properties:{},required:[]},execute:__name(async(e,t)=>{if(!t?.onQuestionRequest)return JSON.stringify({error:"Question callback not available"});const n=await t.onQuestionRequest({questions:[{question:"Enter plan mode for read-only exploration and planning?",header:"Plan Mode",options:[{label:"Yes (Recommended)",description:"Switch to plan mode — explore codebase and create an implementation plan"},{label:"No, stay in current mode",description:"Continue without entering plan mode"}],multiSelect:!1}],hideCustomInput:!0,enterPlanMode:!0});return(n?.answers?.[0]?.selectedOptions?.[0]||"").startsWith("Yes")?"User approved. Entered plan mode. Begin exploring the codebase to understand the task.":"User chose to stay in current mode. Proceed normally."},"execute")}}})
