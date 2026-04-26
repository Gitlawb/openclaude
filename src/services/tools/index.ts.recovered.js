/*
Recovered module wrapper
Original path: src/tools/index.ts
Init symbol: rv
Statement range: 628773-629496
Wrapper range: 628780-629495
Approximate segment: ../../../segments/0197__src-tools-index.ts.mjs
Resolved init dependencies:
- src/tools/grep/index.ts
- src/tools/web-fetch/index.ts
- src/mcp/client/tool-adapter.ts
- src/tools/glob/index.ts
- src/tui/vscode-context/ipc-client.ts
- src/tools/get-tools-for-mode.ts
- ../../node_modules/.pnpm/tsup@8.5.1_jiti@2.6.1_postcss@8.5.6_tsx@4.21.0_typescript@5.9.3_yaml@2.8.2/node_modules/tsup/assets/esm_shims.js
- src/tools/killshell/index.ts
- src/tools/thinking/index.ts
- src/tools/agents/index.ts
- src/tools/get-diagnostics/index.ts
- src/tools/web-search/index.ts
- src/tools/exit-plan-mode/index.ts
- src/utils/telemetry/telemetry.ts
- src/tools/read-file/index.ts
- src/tools/shell-command/index.ts
- src/tools/enter-plan-mode/index.ts
- src/mcp/client/connection-manager.ts
- src/tools/read-multiple-files/index.ts
- ../shared/src/constants/tools.ts
- src/tools/edit-file/index.ts
- src/tools/todo-write/index.ts
- src/tools/write-file/index.ts
- src/tools/read-directory/index.ts
- src/tools/ask-user-question/index.ts
- src/tools/get-self-knowledge/index.ts
- src/utils/taste-path-validator.ts

Note:
The larger segment file usually contains hoisted declarations that belonged to this source file before bundling.
This file preserves the exact __esm wrapper slice for quick per-path inspection.
*/

__esm({"src/tools/index.ts"(){Ht(),Ow(),eS(),iS(),hS(),_S(),$S(),BS(),QS(),JS(),eb(),ib(),Ib(),Nb(),Rb(),Mb(),$b(),Kb(),nE(),Db(),aw(),AE(),TE(),KC(),nv(),No(),FC(),YC=[Nw,Yw,rS,cS,wS,IS,OS,HS,KS,XS,nb,cb,ub,db,Fb,Jb],JC=[mb,pb],XC=new Map(YC.map(e=>[e.name,e])),ZC=new Set([...YC.map(e=>e.name),...JC.map(e=>e.name)]),__name(isAgentTool,"isAgentTool"),__name(executeTool,"executeTool"),__name(getToolSchemas,"getToolSchemas"),__name(toPascalCase,"toPascalCase"),ev={},YC.forEach(e=>{ev[e.name]=toPascalCase(e.name)}),JC.forEach(e=>{ev[e.name]=toPascalCase(e.name)}),tv={},Object.entries(ev).forEach(([e,t])=>{tv[t]=e}),initializeAgentManager({clientTools:YC,serverTools:JC,toolsMap:XC,displayNameToToolName:tv})}})
