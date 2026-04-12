# Changelog

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
