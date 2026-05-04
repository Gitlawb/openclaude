# Changelog

## [0.8.0](https://github.com/Gitlawb/openclaude/compare/v0.7.0...v0.8.0) (2026-05-02)


### Features

* add Opus 4.7 as default model and fix alias/thinking bugs ([#928](https://github.com/Gitlawb/openclaude/issues/928)) ([4c93a9f](https://github.com/Gitlawb/openclaude/commit/4c93a9f9f168217d4bdd53d103337e43f28be074))
* add streaming token counter ([#797](https://github.com/Gitlawb/openclaude/issues/797)) ([0ca4333](https://github.com/Gitlawb/openclaude/commit/0ca43335375beec6e58711b797d5b0c4bb5019b8))
* **api:** deterministic request-body serialization via stableStringify ([#882](https://github.com/Gitlawb/openclaude/issues/882)) ([6ea3eb6](https://github.com/Gitlawb/openclaude/commit/6ea3eb64830ccfec1436bcebe2406158e14a7e81))
* **cli:** improve SSH interactivity detection via SSH_TTY and SSH_CONNECTION ([#946](https://github.com/Gitlawb/openclaude/issues/946)) ([aae96aa](https://github.com/Gitlawb/openclaude/commit/aae96aa52a1241661116d62aac884ddeafd7835b))
* context preloading and hybrid context strategy ([#860](https://github.com/Gitlawb/openclaude/issues/860)) ([92d297e](https://github.com/Gitlawb/openclaude/commit/92d297e50efcc7225f57f0d3cb0ba989dc40d624))
* **lsp:** add first-class code intelligence setup ([#950](https://github.com/Gitlawb/openclaude/issues/950)) ([677d29f](https://github.com/Gitlawb/openclaude/commit/677d29ffd42410710150f1eb8942190c8d317fe0))
* SDK Core — Permission System, Async Context, and Engine Extensions ([#951](https://github.com/Gitlawb/openclaude/issues/951)) ([a46b31c](https://github.com/Gitlawb/openclaude/commit/a46b31c3ec1840a712b9ad2cdd4f9d0f359544c9))
* SDK Foundation — Type Declarations, Errors, and Utilities ([#866](https://github.com/Gitlawb/openclaude/issues/866)) ([91f93ce](https://github.com/Gitlawb/openclaude/commit/91f93ce61533a9cadd1d107e09a442451c09f5db))


### Bug Fixes

* avoid legacy Windows PasswordVault reads by default ([#941](https://github.com/Gitlawb/openclaude/issues/941)) ([d321c8f](https://github.com/Gitlawb/openclaude/commit/d321c8fc6a0be6731c1ccfec0fca8023b1a8b67e))
* **errors:** show actual host in 404 message instead of Ollama hint ([#926](https://github.com/Gitlawb/openclaude/issues/926)) ([#931](https://github.com/Gitlawb/openclaude/issues/931)) ([4fab8b9](https://github.com/Gitlawb/openclaude/commit/4fab8b913f8b5301b98eb8dcf42dd75f095a3c60))
* **input:** strip leading ! when entering bash mode ([#947](https://github.com/Gitlawb/openclaude/issues/947)) ([5943c5c](https://github.com/Gitlawb/openclaude/commit/5943c5c269cdeba45879dac0d8da0082e28cc2a2)), closes [#662](https://github.com/Gitlawb/openclaude/issues/662)
* **oauth:** skip refresh for third-party providers ([#955](https://github.com/Gitlawb/openclaude/issues/955)) ([208c896](https://github.com/Gitlawb/openclaude/commit/208c896c07b878e2859fbae7e0f31697d59943ce))
* **openai-shim:** don't label transport failures as HTTP 503 ([#971](https://github.com/Gitlawb/openclaude/issues/971)) ([#975](https://github.com/Gitlawb/openclaude/issues/975)) ([cc0dab6](https://github.com/Gitlawb/openclaude/commit/cc0dab60a3721921f949165b93c8c997b1aae4a2))
* **openai-shim:** strip `store` when baseUrl points at Gemini ([#959](https://github.com/Gitlawb/openclaude/issues/959)) ([0f0fd26](https://github.com/Gitlawb/openclaude/commit/0f0fd266dbe9363b0ea1db29d8c10ed0b9b18413)), closes [#664](https://github.com/Gitlawb/openclaude/issues/664)
* **plugins:** sanitize env before spawning git so /plugin marketplace add works ([#751](https://github.com/Gitlawb/openclaude/issues/751)) ([#934](https://github.com/Gitlawb/openclaude/issues/934)) ([5c4fdca](https://github.com/Gitlawb/openclaude/commit/5c4fdca21743f82071d0ee22534d61c9ad677efe))
* **provider:** apply Codex OAuth session switch correctly ([#974](https://github.com/Gitlawb/openclaude/issues/974)) ([95a817f](https://github.com/Gitlawb/openclaude/commit/95a817fdb08a97b6293c6c7f87457bcd98283714))
* **ripgrep:** use @vscode/ripgrep package as the builtin source ([#911](https://github.com/Gitlawb/openclaude/issues/911)) ([#932](https://github.com/Gitlawb/openclaude/issues/932)) ([ee0d930](https://github.com/Gitlawb/openclaude/commit/ee0d9300939db0c6178bfad4707a0be45f126d1f))
* **typecheck:** make `bun run typecheck` actionable on main ([#473](https://github.com/Gitlawb/openclaude/issues/473)) ([#938](https://github.com/Gitlawb/openclaude/issues/938)) ([8106880](https://github.com/Gitlawb/openclaude/commit/8106880855ee0bb4b5bbca8827cfe97fe99558b8))
* **worktree:** surface git stderr in rev-parse failure message ([#690](https://github.com/Gitlawb/openclaude/issues/690)) ([#954](https://github.com/Gitlawb/openclaude/issues/954)) ([7711dda](https://github.com/Gitlawb/openclaude/commit/7711ddae4807332526ea128c0246b479d5c0ed00))

## [0.7.0](https://github.com/Gitlawb/openclaude/compare/v0.6.0...v0.7.0) (2026-04-26)


### Features

* add model-specific tokenizers and compression ratio detection ([#799](https://github.com/Gitlawb/openclaude/issues/799)) ([e92e527](https://github.com/Gitlawb/openclaude/commit/e92e5274b223d935d380b1fbd234cb631ab03211))
* add OPENCLAUDE_DISABLE_TOOL_REMINDERS env var to suppress hidden tool-output reminders ([#837](https://github.com/Gitlawb/openclaude/issues/837)) ([28de94d](https://github.com/Gitlawb/openclaude/commit/28de94df5dcd7718cb334e2e793e9472f5b291c5)), closes [#809](https://github.com/Gitlawb/openclaude/issues/809)
* add streaming optimizer and structured request logging ([#703](https://github.com/Gitlawb/openclaude/issues/703)) ([5b9cd21](https://github.com/Gitlawb/openclaude/commit/5b9cd21e373823a77fd552d6e02f5d4b68ae06b1))
* add xAI as official provider ([#865](https://github.com/Gitlawb/openclaude/issues/865)) ([2586a9c](https://github.com/Gitlawb/openclaude/commit/2586a9cddbd2512826bca81cb5deb3ec97f00f0f))
* **api:** expose cache metrics in REPL + normalize across providers ([#813](https://github.com/Gitlawb/openclaude/issues/813)) ([9e23c2b](https://github.com/Gitlawb/openclaude/commit/9e23c2bec43697187762601db5b1585c9b0fb1a3))
* implement Hook Chains runtime integration for self-healing agent mesh MVP ([#711](https://github.com/Gitlawb/openclaude/issues/711)) ([44a2c30](https://github.com/Gitlawb/openclaude/commit/44a2c30d5f9b98027e454466c680360f6b4625fc))
* **memory:** implement persistent project-level Knowledge Graph and RAG ([#899](https://github.com/Gitlawb/openclaude/issues/899)) ([29f7579](https://github.com/Gitlawb/openclaude/commit/29f757937732be0f8cca2bc0627a27eeafc2a992))
* **minimax:** add /usage support and fix MiniMax quota parsing ([#869](https://github.com/Gitlawb/openclaude/issues/869)) ([26413f6](https://github.com/Gitlawb/openclaude/commit/26413f6d307928a4f14c9c61c9860a28f8d81358))
* **model:** add GPT-5.5 support for Codex provider ([#880](https://github.com/Gitlawb/openclaude/issues/880)) ([038f715](https://github.com/Gitlawb/openclaude/commit/038f715b7ab9714340bda421b73a86d8590cf531))
* **tools:** resilient web search and fetch across all providers ([#836](https://github.com/Gitlawb/openclaude/issues/836)) ([531e3f1](https://github.com/Gitlawb/openclaude/commit/531e3f10592a73d81f26675c2479d46a3d5b55f5))
* **zai:** add Z.AI GLM Coding Plan provider preset ([#896](https://github.com/Gitlawb/openclaude/issues/896)) ([a0d657e](https://github.com/Gitlawb/openclaude/commit/a0d657ee188f52f8a4ceaad1658c81343a32fdad))


### Bug Fixes

* **agent:** provider-aware fallback for haiku/sonnet aliases ([#908](https://github.com/Gitlawb/openclaude/issues/908)) ([a3e728a](https://github.com/Gitlawb/openclaude/commit/a3e728a114f6379b80daefc8abcac17a752c5f96))
* bugs ([#885](https://github.com/Gitlawb/openclaude/issues/885)) ([c6c5f06](https://github.com/Gitlawb/openclaude/commit/c6c5f0608cf6509b412b121954547d72b3f3a411))
* make OpenAI fallback context window configurable + support external model lookup ([#861](https://github.com/Gitlawb/openclaude/issues/861)) ([b750e9e](https://github.com/Gitlawb/openclaude/commit/b750e9e97d15926d094d435772b2d6d12e5e545c))
* **mcp:** disable MCP_SKILLS feature flag — source not mirrored ([#872](https://github.com/Gitlawb/openclaude/issues/872)) ([dcbe295](https://github.com/Gitlawb/openclaude/commit/dcbe29558ab9c74d335b138488005a6509aa906a))
* normalize /provider multi-model selection and semicolon parsing ([#841](https://github.com/Gitlawb/openclaude/issues/841)) ([c4cb98a](https://github.com/Gitlawb/openclaude/commit/c4cb98a4f092062da02a4728cf59fed0fc3a6d3f))
* **openai-shim:** echo reasoning_content on assistant tool-call messages for Moonshot ([#828](https://github.com/Gitlawb/openclaude/issues/828)) ([67de6bd](https://github.com/Gitlawb/openclaude/commit/67de6bd2cffc3381f0f28fd3ffce043970611667))
* **query:** restore system prompt structure and add missing config import ([#907](https://github.com/Gitlawb/openclaude/issues/907)) ([818689b](https://github.com/Gitlawb/openclaude/commit/818689b2ee71cb6966cb4dc5a5ebd90fd22b0fcb))
* **shell:** recover when CWD path was replaced by a non-directory ([#871](https://github.com/Gitlawb/openclaude/issues/871)) ([a4c6757](https://github.com/Gitlawb/openclaude/commit/a4c67570238794317d049a225396672b465fdbfc))
* **startup:** show --model flag override on startup screen ([#898](https://github.com/Gitlawb/openclaude/issues/898)) ([d45628c](https://github.com/Gitlawb/openclaude/commit/d45628c41300b83b466e6a97983099615a50e7d7))
* **startup:** url authoritative over model name in banner provider detect ([#864](https://github.com/Gitlawb/openclaude/issues/864)) ([e346b8d](https://github.com/Gitlawb/openclaude/commit/e346b8d5ec2d58a4e8db337918d52d844ee52766)), closes [#855](https://github.com/Gitlawb/openclaude/issues/855)
* surface actionable error when DuckDuckGo web search is rate-limited ([#834](https://github.com/Gitlawb/openclaude/issues/834)) ([3c4d843](https://github.com/Gitlawb/openclaude/commit/3c4d8435c42e1ee04f9defd31c4c589017f524c5))
* **test:** add missing teammate exports to hookChains integration mock ([#840](https://github.com/Gitlawb/openclaude/issues/840)) ([23e8cfb](https://github.com/Gitlawb/openclaude/commit/23e8cfbd5b22179684276bef4131e26b830ce69c)), closes [#839](https://github.com/Gitlawb/openclaude/issues/839)
* **update:** show real package version and give actionable guidance ([#870](https://github.com/Gitlawb/openclaude/issues/870)) ([6e58b81](https://github.com/Gitlawb/openclaude/commit/6e58b819370128b923dda4fcc774bb556f4b951a))

## [0.6.0](https://github.com/Gitlawb/openclaude/compare/v0.5.2...v0.6.0) (2026-04-22)


### Features

* add model caching and benchmarking utilities ([#671](https://github.com/Gitlawb/openclaude/issues/671)) ([2b15e16](https://github.com/Gitlawb/openclaude/commit/2b15e16421f793f954a92c53933a07094544b29d))
* add thinking token extraction ([#798](https://github.com/Gitlawb/openclaude/issues/798)) ([268c039](https://github.com/Gitlawb/openclaude/commit/268c0398e4bf1ab898069c61500a2b3c226a0322))
* **api:** compress old tool_result content for small-context providers ([#801](https://github.com/Gitlawb/openclaude/issues/801)) ([a6a3de5](https://github.com/Gitlawb/openclaude/commit/a6a3de5ac155fe9d00befbfcab98d439314effd8))
* **api:** improve local provider reliability with readiness and self-healing ([#738](https://github.com/Gitlawb/openclaude/issues/738)) ([4cb963e](https://github.com/Gitlawb/openclaude/commit/4cb963e660dbd6ee438c04042700db05a9d32c59))
* **api:** smart model routing primitive (cheap-for-simple, strong-for-hard) ([#785](https://github.com/Gitlawb/openclaude/issues/785)) ([e908864](https://github.com/Gitlawb/openclaude/commit/e908864da7e7c987a98053ac5d18d702e192db2b))
* enable 15 additional feature flags in open build ([#667](https://github.com/Gitlawb/openclaude/issues/667)) ([6a62e3f](https://github.com/Gitlawb/openclaude/commit/6a62e3ff76ba9ba446b8e20cf2bb139ee76a9387))
* native Anthropic API mode for Claude models on GitHub Copilot ([#579](https://github.com/Gitlawb/openclaude/issues/579)) ([fdef4a1](https://github.com/Gitlawb/openclaude/commit/fdef4a1b4ce218ded4937ca83b30acce7c726472))
* **provider:** expose Atomic Chat in /provider picker with autodetect ([#810](https://github.com/Gitlawb/openclaude/issues/810)) ([ee19159](https://github.com/Gitlawb/openclaude/commit/ee19159c17b3de3b4a8b4a4541a6569f4261d54e))
* **provider:** zero-config autodetection primitive ([#784](https://github.com/Gitlawb/openclaude/issues/784)) ([a5bfcbb](https://github.com/Gitlawb/openclaude/commit/a5bfcbbadf8e9a1fd42f3e103d295524b8da64b0))


### Bug Fixes

* **api:** ensure strict role sequence and filter empty assistant messages after interruption ([#745](https://github.com/Gitlawb/openclaude/issues/745) regression) ([#794](https://github.com/Gitlawb/openclaude/issues/794)) ([06e7684](https://github.com/Gitlawb/openclaude/commit/06e7684eb56df8e694ac784575e163641931c44c))
* Collapse all-text arrays to string for DeepSeek compatibility ([#806](https://github.com/Gitlawb/openclaude/issues/806)) ([761924d](https://github.com/Gitlawb/openclaude/commit/761924daa7e225fe8acf41651408c7cae639a511))
* **model:** codex/nvidia-nim/minimax now read OPENAI_MODEL env ([#815](https://github.com/Gitlawb/openclaude/issues/815)) ([4581208](https://github.com/Gitlawb/openclaude/commit/458120889f6ce54cc9f0b287461d5e38eae48a20))
* **provider:** saved profile ignored when stale CLAUDE_CODE_USE_* in shell ([#807](https://github.com/Gitlawb/openclaude/issues/807)) ([13de4e8](https://github.com/Gitlawb/openclaude/commit/13de4e85df7f5fadc8cd15a76076374dc112360b))
* rename .claude.json to .openclaude.json with legacy fallback ([#582](https://github.com/Gitlawb/openclaude/issues/582)) ([4d4fb28](https://github.com/Gitlawb/openclaude/commit/4d4fb2880e4d0e3a62d8715e1ec13d932e736279))
* replace discontinued gemini-2.5-pro-preview-03-25 with stable gemini-2.5-pro ([#802](https://github.com/Gitlawb/openclaude/issues/802)) ([64582c1](https://github.com/Gitlawb/openclaude/commit/64582c119d5d0278195271379da4a68d59a89c1f)), closes [#398](https://github.com/Gitlawb/openclaude/issues/398)
* **security:** harden project settings trust boundary + MCP sanitization ([#789](https://github.com/Gitlawb/openclaude/issues/789)) ([ae3b723](https://github.com/Gitlawb/openclaude/commit/ae3b723f3b297b49925cada4728f3174aee8bf12))
* **test:** autoCompact floor assertion is flag-sensitive ([#816](https://github.com/Gitlawb/openclaude/issues/816)) ([c13842e](https://github.com/Gitlawb/openclaude/commit/c13842e91c7227246520955de6ae0636b30def9a))
* **ui:** prevent provider manager lag by deferring sync I/O ([#803](https://github.com/Gitlawb/openclaude/issues/803)) ([85eab27](https://github.com/Gitlawb/openclaude/commit/85eab2751e7d351bb0ed6a3fe0e15461d241c9cb))

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
