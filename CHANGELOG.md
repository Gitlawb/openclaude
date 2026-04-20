# Changelog

## [0.5.2](https://github.com/Gitlawb/openclaude/compare/v0.5.1...v0.5.2) (2026-04-20)


### Bug Fixes

* **api:** replace phrase-based reasoning sanitizer with tag-based filter ([#779](https://github.com/Gitlawb/openclaude/issues/779)) ([336ddcc](https://github.com/Gitlawb/openclaude/commit/336ddcc50d59d79ebff50993f2673652aecb0d7d))

## [0.5.1](https://github.com/Gitlawb/openclaude/compare/v0.5.0...v0.5.1) (2026-04-20)


### Bug Fixes

* enforce Bash path constraints after sandbox allow ([#777](https://github.com/Gitlawb/openclaude/issues/777)) ([7002cb3](https://github.com/Gitlawb/openclaude/commit/7002cb302b78ea2a19da3f26226de24e2903fa1d))
* enforce MCP OAuth callback state before errors ([#775](https://github.com/Gitlawb/openclaude/issues/775)) ([739b8d1](https://github.com/Gitlawb/openclaude/commit/739b8d1f40fde0e401a5cbd2b9a55d88bd5124ad))
* require trusted approval for sandbox override ([#778](https://github.com/Gitlawb/openclaude/issues/778)) ([aab4890](https://github.com/Gitlawb/openclaude/commit/aab489055c53dd64369414116fe93226d2656273))

## [0.5.0](https://github.com/Gitlawb/openclaude/compare/v0.4.0...v0.5.0) (2026-04-20)


### Features

* add OPENCLAUDE_DISABLE_STRICT_TOOLS env var to opt out of strict MCP tool schema normalization ([#770](https://github.com/Gitlawb/openclaude/issues/770)) ([e6e8d9a](https://github.com/Gitlawb/openclaude/commit/e6e8d9a24897e4c9ef08b72df20fabbf8ef27f38))
* mask provider api key input ([#772](https://github.com/Gitlawb/openclaude/issues/772)) ([13e9f22](https://github.com/Gitlawb/openclaude/commit/13e9f22a83a2b0f85f557b1e12c9442ba61241e4))


### Bug Fixes

* allow provider recovery during startup ([#765](https://github.com/Gitlawb/openclaude/issues/765)) ([f828171](https://github.com/Gitlawb/openclaude/commit/f828171ef1ab94e2acf73a28a292799e4e26cc0d))
* **api:** drop orphan tool results to satisfy strict role sequence ([#745](https://github.com/Gitlawb/openclaude/issues/745)) ([b786b76](https://github.com/Gitlawb/openclaude/commit/b786b765f01f392652eaf28ed3579a96b7260a53))
* **help:** prevent /help tab crash from undefined descriptions ([#732](https://github.com/Gitlawb/openclaude/issues/732)) ([3d1979f](https://github.com/Gitlawb/openclaude/commit/3d1979ff066db32415e0c8321af916d81f5f2621))
* **mcp:** sync required array with properties in tool schemas ([#754](https://github.com/Gitlawb/openclaude/issues/754)) ([002a8f1](https://github.com/Gitlawb/openclaude/commit/002a8f1f6de2fcfc917165d828501d3047bad61f))
* remove cached mcpClient in diagnostic tracking to prevent stale references ([#727](https://github.com/Gitlawb/openclaude/issues/727)) ([2c98be7](https://github.com/Gitlawb/openclaude/commit/2c98be700274a4241963b5f43530bf3bd8f8963f))
* use raw context window for auto-compact percentage display ([#748](https://github.com/Gitlawb/openclaude/issues/748)) ([55c5f26](https://github.com/Gitlawb/openclaude/commit/55c5f262a9a5a8be0aa9ae8dc6c7dafc465eb2c6))

## [0.4.0](https://github.com/Gitlawb/openclaude/compare/v0.3.0...v0.4.0) (2026-04-17)


### Features

* add Alibaba Coding Plan (DashScope) provider support ([#509](https://github.com/Gitlawb/openclaude/issues/509)) ([43ac6db](https://github.com/Gitlawb/openclaude/commit/43ac6dba75537282da1e2ad8f855082bc4e25f1e))
* add NVIDIA NIM and MiniMax provider support ([#552](https://github.com/Gitlawb/openclaude/issues/552)) ([51191d6](https://github.com/Gitlawb/openclaude/commit/51191d61326e1f8319d70b3a3c0d9229e185a564))
* add ripgrep to Dockerfile for faster file searching ([#688](https://github.com/Gitlawb/openclaude/issues/688)) ([12dd375](https://github.com/Gitlawb/openclaude/commit/12dd3755c619cc27af3b151ae8fdb9d425a7b9a2))
* **api:** classify openai-compatible provider failures ([#708](https://github.com/Gitlawb/openclaude/issues/708)) ([80a00ac](https://github.com/Gitlawb/openclaude/commit/80a00acc2c6dc4657a78de7366f7a9ebc920bfbb))
* **vscode:** add full chat interface to OpenClaude extension ([#608](https://github.com/Gitlawb/openclaude/issues/608)) ([fbcd928](https://github.com/Gitlawb/openclaude/commit/fbcd928f7f8511da795aea3ad318bddf0ab9a1a7))


### Bug Fixes

* focus "Done" option after completing provider manager actions ([#718](https://github.com/Gitlawb/openclaude/issues/718)) ([d6f5130](https://github.com/Gitlawb/openclaude/commit/d6f5130c204d8ffe582212466768706cd7fd6774))
* **models:** prevent /models crash from non-string saved model values ([#691](https://github.com/Gitlawb/openclaude/issues/691)) ([6b2121d](https://github.com/Gitlawb/openclaude/commit/6b2121da12189fa7ce1f33394d18abd24cf8a01b))
* prevent crash in commands tab when description is undefined ([#730](https://github.com/Gitlawb/openclaude/issues/730)) ([eed77e6](https://github.com/Gitlawb/openclaude/commit/eed77e6579866a98384dcc948a0ad6406614ede3))
* strip comments before scanning for missing imports ([#676](https://github.com/Gitlawb/openclaude/issues/676)) ([a00b792](https://github.com/Gitlawb/openclaude/commit/a00b7928de9662ffb7ef6abd8cd040afe6f4f122))
* **ui:** show correct endpoint URL in intro screen for custom Anthropic endpoints ([#735](https://github.com/Gitlawb/openclaude/issues/735)) ([3424663](https://github.com/Gitlawb/openclaude/commit/34246635fb9a09499047a52e7f96ca9b36c8a85a))

## [0.3.0](https://github.com/Gitlawb/openclaude/compare/v0.2.3...v0.3.0) (2026-04-14)


### Features

* activate coordinator mode in open build ([#647](https://github.com/Gitlawb/openclaude/issues/647)) ([99a1714](https://github.com/Gitlawb/openclaude/commit/99a17144ee285b892a0801acb6abcc9af68879af))
* activate local-only team memory in open build ([#648](https://github.com/Gitlawb/openclaude/issues/648)) ([24d485f](https://github.com/Gitlawb/openclaude/commit/24d485f42f5b1405d2fab13f2f497d5edd3b5300))
* activate message actions in open build ([#632](https://github.com/Gitlawb/openclaude/issues/632)) ([252808b](https://github.com/Gitlawb/openclaude/commit/252808bbd0a12a6ccf97e2cb09752a0212ea3acd))
* add allowBypassPermissionsMode setting ([#658](https://github.com/Gitlawb/openclaude/issues/658)) ([31be66d](https://github.com/Gitlawb/openclaude/commit/31be66d7645ea3473334c9ce89ea1a5095b8df6e))
* add Docker image build and push to GHCR on release ([#656](https://github.com/Gitlawb/openclaude/issues/656)) ([658d076](https://github.com/Gitlawb/openclaude/commit/658d076909e14eb0459bcb98aee9aa0472118265))
* implement /loop command with fixed and dynamic scheduling ([#621](https://github.com/Gitlawb/openclaude/issues/621)) ([64298a6](https://github.com/Gitlawb/openclaude/commit/64298a663f1391b16aa1f5a49e8a877e1d3742f2))
* implement Monitor tool for streaming shell output ([#649](https://github.com/Gitlawb/openclaude/issues/649)) ([b818dd5](https://github.com/Gitlawb/openclaude/commit/b818dd5958f4e8428566ce25a1a6be5fd4fe66f8))
* local feature flag overrides via ~/.claude/feature-flags.json ([#639](https://github.com/Gitlawb/openclaude/issues/639)) ([0e48884](https://github.com/Gitlawb/openclaude/commit/0e48884f56c6c008f047a7926d3b2cb924170625))
* open useful USER_TYPE-gated features to all users ([#644](https://github.com/Gitlawb/openclaude/issues/644)) ([c1beea9](https://github.com/Gitlawb/openclaude/commit/c1beea98676a413c54152a45a6b9fbe7fb9ed028))


### Bug Fixes

* bump axios 1.14.0 → 1.15.0 (Dependabot [#4](https://github.com/Gitlawb/openclaude/issues/4), [#5](https://github.com/Gitlawb/openclaude/issues/5)) ([#670](https://github.com/Gitlawb/openclaude/issues/670)) ([a07e5ef](https://github.com/Gitlawb/openclaude/commit/a07e5ef990a5ed01a72e83fdbd1fcab36f515a08))
* extend provider guard to protect anthropic profiles from cross-terminal override ([#641](https://github.com/Gitlawb/openclaude/issues/641)) ([03e0b06](https://github.com/Gitlawb/openclaude/commit/03e0b06e0784e4ea46945b3950840b10b6e3ca49))
* improve fetch diagnostics for bootstrap and session requests ([#646](https://github.com/Gitlawb/openclaude/issues/646)) ([df2b9f2](https://github.com/Gitlawb/openclaude/commit/df2b9f2b7b4c661ee3d9ed5dc58b3064de0599d1))
* **openai-shim:** preserve tool result images and local token caps ([#659](https://github.com/Gitlawb/openclaude/issues/659)) ([30c866d](https://github.com/Gitlawb/openclaude/commit/30c866d31ad8538496460667d86ed5efbd4a8547))
* replace broken bun:bundle shim with source pre-processing ([#657](https://github.com/Gitlawb/openclaude/issues/657)) ([adbe391](https://github.com/Gitlawb/openclaude/commit/adbe391e63721918b5d147f4f845111c1a3143db))
* resolve 12 bugs across API, MCP, agent tools, web search, and context overflow ([#674](https://github.com/Gitlawb/openclaude/issues/674)) ([25ce2ca](https://github.com/Gitlawb/openclaude/commit/25ce2ca7bff8937b0b79ad7f85c6dc1c68432069))
* route OpenAI Codex shortcuts to correct endpoint ([#566](https://github.com/Gitlawb/openclaude/issues/566)) ([7c8bdcc](https://github.com/Gitlawb/openclaude/commit/7c8bdcc3e2ac1ecb98286c705c85671044be3d6b))

## [0.2.3](https://github.com/Gitlawb/openclaude/compare/v0.2.2...v0.2.3) (2026-04-12)


### Bug Fixes

* prevent infinite auto-compact loop for unknown 3P models ([#635](https://github.com/Gitlawb/openclaude/issues/635)) ([#636](https://github.com/Gitlawb/openclaude/issues/636)) ([aeaa658](https://github.com/Gitlawb/openclaude/commit/aeaa658f776fb8df95721e8b8962385f8b00f66a))

## [0.2.2](https://github.com/Gitlawb/openclaude/compare/v0.2.1...v0.2.2) (2026-04-12)


### Bug Fixes

* **read/edit:** make compact line prefix unambiguous for tab-indented files ([#613](https://github.com/Gitlawb/openclaude/issues/613)) ([08cc6f3](https://github.com/Gitlawb/openclaude/commit/08cc6f328711cd93ce9fa53351266c29a0b0a341))

## [0.2.1](https://github.com/Gitlawb/openclaude/compare/v0.2.0...v0.2.1) (2026-04-12)


### Bug Fixes

* **provider:** add recovery guidance for missing OpenAI API key ([#616](https://github.com/Gitlawb/openclaude/issues/616)) ([9419e8a](https://github.com/Gitlawb/openclaude/commit/9419e8a4a21b3771d9ddb10f7072e0a8c5b5b631))

## [0.2.0](https://github.com/Gitlawb/openclaude/compare/v0.1.8...v0.2.0) (2026-04-12)


### Features

* add /cache-probe diagnostic command ([#580](https://github.com/Gitlawb/openclaude/issues/580)) ([9ccaa7a](https://github.com/Gitlawb/openclaude/commit/9ccaa7a6759b6991f4a566b4118c06e68a2398fe)), closes [#515](https://github.com/Gitlawb/openclaude/issues/515)
* add auto-fix service — auto-lint and test after AI file edits ([#508](https://github.com/Gitlawb/openclaude/issues/508)) ([c385047](https://github.com/Gitlawb/openclaude/commit/c385047abba4366866f4c87bfb5e0b0bd4dcbb9d))
* Add Gemini support with thought_signature fix  ([#404](https://github.com/Gitlawb/openclaude/issues/404)) ([5012c16](https://github.com/Gitlawb/openclaude/commit/5012c160c9a2dff9418e7ee19dc9a4d29ef2b024))
* add headless gRPC server for external agent integration ([#278](https://github.com/Gitlawb/openclaude/issues/278)) ([26eef92](https://github.com/Gitlawb/openclaude/commit/26eef92fe72e9c3958d61435b8d3571e12bf2b74))
* add wiki mvp commands ([#532](https://github.com/Gitlawb/openclaude/issues/532)) ([c328fdf](https://github.com/Gitlawb/openclaude/commit/c328fdf9e2fe59ad101b049301298ce9ff24caca))
* GitHub provider lifecycle and onboarding hardening ([#351](https://github.com/Gitlawb/openclaude/issues/351)) ([ff7d499](https://github.com/Gitlawb/openclaude/commit/ff7d49990de515825ddbe4099f3a39b944b61370))


### Bug Fixes

* add File polyfill for Node &lt; 20 to prevent startup deadlock with proxy ([#442](https://github.com/Gitlawb/openclaude/issues/442)) ([85aa8b0](https://github.com/Gitlawb/openclaude/commit/85aa8b0985c8f3cb8801efa5141114a0ab0f6a83))
* add GitHub Copilot model context windows and output limits ([#576](https://github.com/Gitlawb/openclaude/issues/576)) ([a7f5982](https://github.com/Gitlawb/openclaude/commit/a7f5982f6438ab0ddc3f0daae31ea68ac7ac206c)), closes [#515](https://github.com/Gitlawb/openclaude/issues/515)
* add LiteLLM-style aliases for GitHub Copilot context windows ([#606](https://github.com/Gitlawb/openclaude/issues/606)) ([2e0e14d](https://github.com/Gitlawb/openclaude/commit/2e0e14d71313e0e501efaa9e55c6c56f2742fb10))
* add store:false to Chat Completions and /responses fallback ([#578](https://github.com/Gitlawb/openclaude/issues/578)) ([8aaa4f2](https://github.com/Gitlawb/openclaude/commit/8aaa4f22ac5b942d82aa9cad54af30d56034515a))
* address code scanning alerts ([#434](https://github.com/Gitlawb/openclaude/issues/434)) ([e365cb4](https://github.com/Gitlawb/openclaude/commit/e365cb4010becabacd7cbccb4c3e59ea23a41e90))
* avoid sync github credential reads in provider manager ([#428](https://github.com/Gitlawb/openclaude/issues/428)) ([aff2bd8](https://github.com/Gitlawb/openclaude/commit/aff2bd87e4f2821992f74fb95481c505d0ba5d5d))
* convert dragged file paths to [@mentions](https://github.com/mentions) for attachment ([#382](https://github.com/Gitlawb/openclaude/issues/382)) ([112df59](https://github.com/Gitlawb/openclaude/commit/112df5911791ea71ee9efbb98ea59c5ded1ea161))
* custom web search — WEB_URL_TEMPLATE not recognized, timeout too short, silent native fallback ([#537](https://github.com/Gitlawb/openclaude/issues/537)) ([32fbd0c](https://github.com/Gitlawb/openclaude/commit/32fbd0c7b4168b32dcb13a5b69342e2727269201))
* defer startup checks and suppress recommendation dialogs during startup window (issue [#363](https://github.com/Gitlawb/openclaude/issues/363)) ([#504](https://github.com/Gitlawb/openclaude/issues/504)) ([2caf2fd](https://github.com/Gitlawb/openclaude/commit/2caf2fd982af1ec845c50152ad9d28d1a597f82f))
* display selected model in startup screen instead of hardcoded sonnet 4.6 ([#587](https://github.com/Gitlawb/openclaude/issues/587)) ([b126e38](https://github.com/Gitlawb/openclaude/commit/b126e38b1affddd2de83fcc3ba26f2e44b42a509))
* handle missing skill parameter in SkillTool ([#485](https://github.com/Gitlawb/openclaude/issues/485)) ([f9ce81b](https://github.com/Gitlawb/openclaude/commit/f9ce81bfb384e909353813fb6f6760cadd508ae7))
* include MCP tool results in microcompact to reduce token waste ([#348](https://github.com/Gitlawb/openclaude/issues/348)) ([52d33a8](https://github.com/Gitlawb/openclaude/commit/52d33a87a047b943aedaaaf772cd48636c263509))
* **ink:** restore host prop updates in React 19 reconciler ([#589](https://github.com/Gitlawb/openclaude/issues/589)) ([6e94dd9](https://github.com/Gitlawb/openclaude/commit/6e94dd913688b2d6433a9abe62a245c5f031b776))
* let saved provider profiles win on restart ([#513](https://github.com/Gitlawb/openclaude/issues/513)) ([cb8f8b7](https://github.com/Gitlawb/openclaude/commit/cb8f8b7ac2e3e74516ee219a3a48156db7c6ed78))
* normalize malformed Bash tool arguments from OpenAI-compatible providers ([#385](https://github.com/Gitlawb/openclaude/issues/385)) ([b4bd95b](https://github.com/Gitlawb/openclaude/commit/b4bd95b47715c9896240d708c106777507fd26ec))
* preserve only originally-required properties in strict tool schemas ([#471](https://github.com/Gitlawb/openclaude/issues/471)) ([ccaa193](https://github.com/Gitlawb/openclaude/commit/ccaa193eec5761f0972ffb58eb3189a81a9244b0))
* preserve unicode in Windows clipboard fallback ([#388](https://github.com/Gitlawb/openclaude/issues/388)) ([c193497](https://github.com/Gitlawb/openclaude/commit/c1934974aaf64db460cc850a044bd13cc744cce7))
* rebrand prompt identity to openclaude ([#496](https://github.com/Gitlawb/openclaude/issues/496)) ([598651f](https://github.com/Gitlawb/openclaude/commit/598651f42389ce76311ec00e8a9c701c939ead27))
* replace isDeepStrictEqual with navigation-aware options comparison ([#507](https://github.com/Gitlawb/openclaude/issues/507)) ([537c469](https://github.com/Gitlawb/openclaude/commit/537c469c3a2f7cb0eed05fa2f54dca57b6bc273f)), closes [#472](https://github.com/Gitlawb/openclaude/issues/472)
* report cache reads in streaming and correct cost calculation ([#577](https://github.com/Gitlawb/openclaude/issues/577)) ([f4ac709](https://github.com/Gitlawb/openclaude/commit/f4ac709fa6eda732bf45204fcab625ba6c5674b9))
* restore default context window for unknown 3p models ([#494](https://github.com/Gitlawb/openclaude/issues/494)) ([69ea1f1](https://github.com/Gitlawb/openclaude/commit/69ea1f1e4a99e9436215d8cb391a116a64442b94))
* restore Grep and Glob reliability on OpenAI paths ([#461](https://github.com/Gitlawb/openclaude/issues/461)) ([600c01f](https://github.com/Gitlawb/openclaude/commit/600c01faf761a080a2c7dede872ddbe05a132f23))
* restore Ollama auto-detect in first-run setup ([#561](https://github.com/Gitlawb/openclaude/issues/561)) ([68c2968](https://github.com/Gitlawb/openclaude/commit/68c296833dcef54ce44cb18b24357230b5204dbc))
* scrub canonical Anthropic headers from 3P shim requests ([#499](https://github.com/Gitlawb/openclaude/issues/499)) ([07621a6](https://github.com/Gitlawb/openclaude/commit/07621a6f8d0918170281869a47b5dbff90e71594))
* strip Anthropic params from 3P resume paths ([#479](https://github.com/Gitlawb/openclaude/issues/479)) ([4975cfc](https://github.com/Gitlawb/openclaude/commit/4975cfc2e0ddbe34aa4e8e3f52ee5eba07fbe465))
* suppress startup dialogs when input is buffered ([#423](https://github.com/Gitlawb/openclaude/issues/423)) ([8ece290](https://github.com/Gitlawb/openclaude/commit/8ece2900872dadd157e798ef501ddf126dac66c4))
* **tui:** restore prompt rendering on startup ([#498](https://github.com/Gitlawb/openclaude/issues/498)) ([e30ad17](https://github.com/Gitlawb/openclaude/commit/e30ad17ae0056787273be2caafd6cf5340b6ab57))
* update theme preview on focus change ([#562](https://github.com/Gitlawb/openclaude/issues/562)) ([6924718](https://github.com/Gitlawb/openclaude/commit/692471850fc789ee0797190089272407f9a4d953))
* **web-search:** close SSRF bypasses in custom provider hostname guard ([#610](https://github.com/Gitlawb/openclaude/issues/610)) ([a02c441](https://github.com/Gitlawb/openclaude/commit/a02c44143b257fbee7f38f1b93873cc0ea68a1f9))
* WebSearch providers + MCPTool bugs ([#593](https://github.com/Gitlawb/openclaude/issues/593)) ([91e4cfb](https://github.com/Gitlawb/openclaude/commit/91e4cfb15b62c04615834fd3c417fe38b4feb914))
