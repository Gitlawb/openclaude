# Changelog

## [0.19.0](https://github.com/Gitlawb/openclaude/compare/v0.18.0...v0.19.0) (2026-06-16)


### Features

* add NEAR AI provider integration ([#1594](https://github.com/Gitlawb/openclaude/issues/1594)) ([eacc7d8](https://github.com/Gitlawb/openclaude/commit/eacc7d8facc6e94acacc58ec205f377681107c50))
* add redacted diagnostic issue reports ([#1647](https://github.com/Gitlawb/openclaude/issues/1647)) ([7c034c5](https://github.com/Gitlawb/openclaude/commit/7c034c5a62a972efb9c0d4fdb1ff1bd1dea2168f))
* add Vietnamese i18n for slash command descriptions ([#1431](https://github.com/Gitlawb/openclaude/issues/1431)) ([89d0531](https://github.com/Gitlawb/openclaude/commit/89d05317b6b6f6c45008ff7074e74a3638d3246b))
* **agent-routing:** model-only agent routes (set the verifier or any agent's model on the current provider) ([#1617](https://github.com/Gitlawb/openclaude/issues/1617)) ([9e902db](https://github.com/Gitlawb/openclaude/commit/9e902db86617aba657235b5687a47080173e4bbf))
* **compact:** auto-compact prompt on /resume + determinate progress bar ([#1386](https://github.com/Gitlawb/openclaude/issues/1386)) ([716c1d4](https://github.com/Gitlawb/openclaude/commit/716c1d47f68349f5f5f151090292d2544cf83cf9))
* **config:** add compactModel option to use a separate model for compaction ([#1445](https://github.com/Gitlawb/openclaude/issues/1445)) ([#1629](https://github.com/Gitlawb/openclaude/issues/1629)) ([0c45e16](https://github.com/Gitlawb/openclaude/commit/0c45e16f189487955caec7861f00d0eb5d4c5341))
* **ctx:** add /ctx context window visualization and token bars to /cost ([#1610](https://github.com/Gitlawb/openclaude/issues/1610)) ([c2cf603](https://github.com/Gitlawb/openclaude/commit/c2cf60334421736a0e1f183ae0f8ff766ad4ecdf))
* **gemini-vertex:** native Gemini Vertex client and auth helpers (1/3) ([#1607](https://github.com/Gitlawb/openclaude/issues/1607)) ([b9c65de](https://github.com/Gitlawb/openclaude/commit/b9c65deabc00d7bdc622c8d30087f2702c8910f1))
* **provider:** add Fireworks AI as official OpenAI-compatible provider ([#1590](https://github.com/Gitlawb/openclaude/issues/1590)) ([0b24b60](https://github.com/Gitlawb/openclaude/commit/0b24b60ce92a108ab062c1a78ce101d4f951c45c))
* **web:** rebuild landing as Astro static site with gitlawb theme and full docs ([#1606](https://github.com/Gitlawb/openclaude/issues/1606)) ([d08593d](https://github.com/Gitlawb/openclaude/commit/d08593de922891bff954985d716e9a906d01538e))


### Bug Fixes

* avoid file suggestion OOM on large repos ([#1074](https://github.com/Gitlawb/openclaude/issues/1074)) ([8f92346](https://github.com/Gitlawb/openclaude/commit/8f92346cf403f41a2176e408b93a814da8c0fd79))
* **copilot:** limit sub-agent concurrency to reduce Premium Request usage ([#678](https://github.com/Gitlawb/openclaude/issues/678)) ([#1534](https://github.com/Gitlawb/openclaude/issues/1534)) ([822eff3](https://github.com/Gitlawb/openclaude/commit/822eff39d1707455f9b0723ff2761f8c412b56a5))
* **gitDiff:** keep hunk content lines beginning with -- or ++ ([#1646](https://github.com/Gitlawb/openclaude/issues/1646)) ([241d52a](https://github.com/Gitlawb/openclaude/commit/241d52af47d179b1042227c176ba44fc6ae4c83f))
* **mcp:** demote successful stdio startup stderr ([#1622](https://github.com/Gitlawb/openclaude/issues/1622)) ([9fbcd75](https://github.com/Gitlawb/openclaude/commit/9fbcd755a3a1b731c63db3034401905133eb83a1))
* Ollama max output token override ([#1659](https://github.com/Gitlawb/openclaude/issues/1659)) ([bac74aa](https://github.com/Gitlawb/openclaude/commit/bac74aafee2c35b4126a07460291f9cba7413e31))
* **ollama:** parse text-based tool calls as fallback ([#1053](https://github.com/Gitlawb/openclaude/issues/1053)) ([#1076](https://github.com/Gitlawb/openclaude/issues/1076)) ([a3f144b](https://github.com/Gitlawb/openclaude/commit/a3f144bbf26be5c7676e9a2f79a747186867f021))
* **plugins:** prevent ENOENT on Windows marketplace cache finalization ([#1500](https://github.com/Gitlawb/openclaude/issues/1500)) ([#1531](https://github.com/Gitlawb/openclaude/issues/1531)) ([a7d6580](https://github.com/Gitlawb/openclaude/commit/a7d65805213b92d3f6eceb46c0c0cc2ffa9dcb01))
* **read:** improve oversized file guidance ([#1626](https://github.com/Gitlawb/openclaude/issues/1626)) ([5fd4a09](https://github.com/Gitlawb/openclaude/commit/5fd4a09d0193431aaed07af2c56351a805db365b))
* rename "Claude" to "OpenClaude" in feedback survey prompt ([#1598](https://github.com/Gitlawb/openclaude/issues/1598)) ([d00b105](https://github.com/Gitlawb/openclaude/commit/d00b1050f5acd07b12fc49bcb4802ab446fef27a))
* sandbox temp dir fallback ([#1662](https://github.com/Gitlawb/openclaude/issues/1662)) ([c3db798](https://github.com/Gitlawb/openclaude/commit/c3db79832bc0c35fb3ba6f652c81106bfe274d39))
* **security:** bundle real sandbox runtime in open CLI ([#1641](https://github.com/Gitlawb/openclaude/issues/1641)) ([bd3ad89](https://github.com/Gitlawb/openclaude/commit/bd3ad89dd788e6efa4b8b9df6a36d841005eee52))
* **session:** filter Anthropic-only params from 3P provider requests ([#248](https://github.com/Gitlawb/openclaude/issues/248)) ([#1533](https://github.com/Gitlawb/openclaude/issues/1533)) ([db2d093](https://github.com/Gitlawb/openclaude/commit/db2d093af3a0ad0dc5fc1b546faa44e56800362f))
* startup provider validation fallback ([#1658](https://github.com/Gitlawb/openclaude/issues/1658)) ([b036e9f](https://github.com/Gitlawb/openclaude/commit/b036e9fa7c5a82b2d01e6b7435109caa36027aa0))
* **suggestions:** stop slash-command dropdown freezing on a throwing getter ([#1657](https://github.com/Gitlawb/openclaude/issues/1657)) ([00ff6de](https://github.com/Gitlawb/openclaude/commit/00ff6de4cacddaa50b9875366e9b5dd4fa7d101f))
* **tool-search:** enable MCP tool deferral on converted-wire providers ([#1608](https://github.com/Gitlawb/openclaude/issues/1608)) ([614a8d9](https://github.com/Gitlawb/openclaude/commit/614a8d9c54fbe3b15c2a907f8de4ad00fa3a3d10))
* **typecheck:** correct fetch mock type casts in test files ([#1592](https://github.com/Gitlawb/openclaude/issues/1592)) ([794ccd4](https://github.com/Gitlawb/openclaude/commit/794ccd4f9e7d96d1eac9e28f97f04e09caf4f8b6))
* **typecheck:** expand cachedMicrocompact stub exports ([#1591](https://github.com/Gitlawb/openclaude/issues/1591)) ([bb19392](https://github.com/Gitlawb/openclaude/commit/bb19392e699a531e8f4b6c8dad3bebbcd2454a51))
* **typecheck:** recreate missing CLI Transport interface ([#1581](https://github.com/Gitlawb/openclaude/issues/1581)) ([3752dfe](https://github.com/Gitlawb/openclaude/commit/3752dfe6f7165285951f2cc534f2a8a01e31a319))
* **typecheck:** reduce error baseline by 89 across 8 files ([#1595](https://github.com/Gitlawb/openclaude/issues/1595)) ([9db9427](https://github.com/Gitlawb/openclaude/commit/9db9427f2961ff13a0d24c4f3261fd9ad5bfa932))
* vision handling for OpenAI-compatible models ([#1663](https://github.com/Gitlawb/openclaude/issues/1663)) ([7be9dce](https://github.com/Gitlawb/openclaude/commit/7be9dce8ef973a7290ef0621276af6d65abc0294))


### Performance Improvements

* **cli:** restore --version fast path with dynamic provider imports ([#1611](https://github.com/Gitlawb/openclaude/issues/1611)) ([a3a3c36](https://github.com/Gitlawb/openclaude/commit/a3a3c3659dbe6b51c3e4027b990bf77b6b020a1a))

## [0.18.0](https://github.com/Gitlawb/openclaude/compare/v0.17.1...v0.18.0) (2026-06-10)


### Features

* add .gitattributes to enforce LF line endings ([#1550](https://github.com/Gitlawb/openclaude/issues/1550)) ([1c27957](https://github.com/Gitlawb/openclaude/commit/1c279577f9b294dbb02f4b8859c60fcaeb840ca6))
* enable HISTORY_SNIP — model-callable snip tool for context management ([#1407](https://github.com/Gitlawb/openclaude/issues/1407)) ([cdc8057](https://github.com/Gitlawb/openclaude/commit/cdc8057496b43b38b62f738c20a2db72986c9683))
* extend --fallback-model to interactive REPL sessions ([#1346](https://github.com/Gitlawb/openclaude/issues/1346)) ([#1419](https://github.com/Gitlawb/openclaude/issues/1419)) ([14e5a41](https://github.com/Gitlawb/openclaude/commit/14e5a41acd7a0349c6c982e44e7f2650199ab971))
* **github:** expose all 21 Copilot models with context window metadata ([#822](https://github.com/Gitlawb/openclaude/issues/822)) ([#1535](https://github.com/Gitlawb/openclaude/issues/1535)) ([1e8c1ac](https://github.com/Gitlawb/openclaude/commit/1e8c1ac8f5c07e7456420e8269851ad0ccc4c1c1))
* **goal:** add session-scoped /goal continuation ([#1293](https://github.com/Gitlawb/openclaude/issues/1293)) ([102cc30](https://github.com/Gitlawb/openclaude/commit/102cc3060fd3fc32eee91c8c3f2df7fd0a9af9fa))
* **opengateway:** surface the gateway's "auto" smart-routing model in /model ([#1588](https://github.com/Gitlawb/openclaude/issues/1588)) ([5040c49](https://github.com/Gitlawb/openclaude/commit/5040c491daa87587f0a3cf10e693c65dd7d5a389))
* **provider:** add Atlas Cloud as official OpenAI-compatible provider ([#1585](https://github.com/Gitlawb/openclaude/issues/1585)) ([5b01c2b](https://github.com/Gitlawb/openclaude/commit/5b01c2b59533b5450f06c2e520b2d45c72930226))


### Bug Fixes

* add error context to silent catches and debugger detection ([#1479](https://github.com/Gitlawb/openclaude/issues/1479)) ([e9b211a](https://github.com/Gitlawb/openclaude/commit/e9b211a2262fc2d9b877c58683a66bdd885531b9))
* **agent-routing:** support API model aliases ([#1546](https://github.com/Gitlawb/openclaude/issues/1546)) ([9a342b6](https://github.com/Gitlawb/openclaude/commit/9a342b61fafce5908ac18f79275b70e51cae6ba4))
* **api:** honor OpenAI-compatible retry classification ([#1547](https://github.com/Gitlawb/openclaude/issues/1547)) ([f1013df](https://github.com/Gitlawb/openclaude/commit/f1013df81828eb1035c054e415ac16c9d84de917))
* **api:** retry once with provider-capped max_tokens ([#1235](https://github.com/Gitlawb/openclaude/issues/1235)) ([edabf33](https://github.com/Gitlawb/openclaude/commit/edabf33a337b700a1937ab453a7872806281beff))
* **claudemd:** gate User-scope external [@include](https://github.com/include) behind hasClaudeMdEx… ([#1223](https://github.com/Gitlawb/openclaude/issues/1223)) ([fde7aa0](https://github.com/Gitlawb/openclaude/commit/fde7aa07a0c83aaf8cf52be5ca93cb2e121cfb79))
* **context:** avoid noisy metadata fallback errors ([#1544](https://github.com/Gitlawb/openclaude/issues/1544)) ([12cbe92](https://github.com/Gitlawb/openclaude/commit/12cbe92344c8d1a8bf07834bcd4c9cbb4dadf665))
* **mcp:** fail-closed on token count error + respect maxChars budget ([#1113](https://github.com/Gitlawb/openclaude/issues/1113)) ([bd8c6b1](https://github.com/Gitlawb/openclaude/commit/bd8c6b1eb5798b8f76dc331222dbf81e99e1b74b))
* **mcp:** pass MCP stdio server args as separate array elements to pr… ([#1222](https://github.com/Gitlawb/openclaude/issues/1222)) ([0d4e247](https://github.com/Gitlawb/openclaude/commit/0d4e2479056238cff7656d43e66818e47daae038))
* **openai-shim:** guarantee reasoning_content continuity for DeepSeek… ([#1228](https://github.com/Gitlawb/openclaude/issues/1228)) ([d67c6d7](https://github.com/Gitlawb/openclaude/commit/d67c6d77d3c7ecd6cc6dd960ae6667afdb16ca02))
* **openai-shim:** include text for image-only user content ([#1410](https://github.com/Gitlawb/openclaude/issues/1410)) ([7c05453](https://github.com/Gitlawb/openclaude/commit/7c05453f7925c52dc006879c8eef9eda10d6a965))
* **provider:** preserve explicit startup env ([#1560](https://github.com/Gitlawb/openclaude/issues/1560)) ([754cb61](https://github.com/Gitlawb/openclaude/commit/754cb61d17f041df483d570050899089e08e6010))
* replace codex input_text with standard text type in generic resp ([#1449](https://github.com/Gitlawb/openclaude/issues/1449)) ([be05594](https://github.com/Gitlawb/openclaude/commit/be05594ce8adbbb202b193b39217e548c05abdc8))
* **typecheck:** add MCP component view types ([#1564](https://github.com/Gitlawb/openclaude/issues/1564)) ([548bffc](https://github.com/Gitlawb/openclaude/commit/548bffc2a77f14047f7558c0bce220fc67ab3ff8))
* **typecheck:** add missing type aliases to message and tools stubs ([#1510](https://github.com/Gitlawb/openclaude/issues/1510)) ([ea75a51](https://github.com/Gitlawb/openclaude/commit/ea75a51054cec75858a343ad7f4ba5ea47b579cb))
* **typecheck:** add missing xai entry to deprecation retirement date maps ([#1509](https://github.com/Gitlawb/openclaude/issues/1509)) ([1d90960](https://github.com/Gitlawb/openclaude/commit/1d90960afac36aa34b46bbbeca0884e420bbe57c)), closes [#1486](https://github.com/Gitlawb/openclaude/issues/1486)
* **typecheck:** add plugin command view types ([#1565](https://github.com/Gitlawb/openclaude/issues/1565)) ([fc0a4b5](https://github.com/Gitlawb/openclaude/commit/fc0a4b5cdf641b59cfda1759bc616269557309ac))
* **typecheck:** add proper type parameters to useState(null) hooks ([#1513](https://github.com/Gitlawb/openclaude/issues/1513)) ([0e30ee8](https://github.com/Gitlawb/openclaude/commit/0e30ee83a625e7f23e3c20838f65207c0b2d6581)), closes [#1486](https://github.com/Gitlawb/openclaude/issues/1486)
* **typecheck:** add wizard agent creation types ([#1566](https://github.com/Gitlawb/openclaude/issues/1566)) ([65034db](https://github.com/Gitlawb/openclaude/commit/65034db3679e170680b6e5d358a781e30ddc65fc))
* **typecheck:** annotate diff rendering props ([#1568](https://github.com/Gitlawb/openclaude/issues/1568)) ([e53d612](https://github.com/Gitlawb/openclaude/commit/e53d612da5ce77b543846256e130a80f0f8f116d))
* **typecheck:** declare bundled markdown and macro fields ([#1562](https://github.com/Gitlawb/openclaude/issues/1562)) ([5c239eb](https://github.com/Gitlawb/openclaude/commit/5c239eb6019949f0161a50999eaa00ddd3ed688b))
* **typecheck:** declare Ink JSX intrinsics ([#1571](https://github.com/Gitlawb/openclaude/issues/1571)) ([38b2d83](https://github.com/Gitlawb/openclaude/commit/38b2d836990ab97d04a906bd967441dafc017fe1))
* **typecheck:** declare optional native modules ([#1563](https://github.com/Gitlawb/openclaude/issues/1563)) ([f129dd0](https://github.com/Gitlawb/openclaude/commit/f129dd039758129d56d47c4e5adf6c87e86091b0))
* **typecheck:** import bun test helpers in truncate test ([#1520](https://github.com/Gitlawb/openclaude/issues/1520)) ([8527a04](https://github.com/Gitlawb/openclaude/commit/8527a04e9b7644dab1322f383383566e9c639e3f))
* **typecheck:** narrow remote agent SDK logs ([#1573](https://github.com/Gitlawb/openclaude/issues/1573)) ([7727a9f](https://github.com/Gitlawb/openclaude/commit/7727a9f3a3ab34468a33f44671cd56c78c1b298d))
* **typecheck:** recreate missing FeedbackSurvey utils ([#1580](https://github.com/Gitlawb/openclaude/issues/1580)) ([62c2c5b](https://github.com/Gitlawb/openclaude/commit/62c2c5b62f431013b1b6eb6ed632a6fc1a678c5d))
* **typecheck:** recreate missing Spinner types ([#1579](https://github.com/Gitlawb/openclaude/issues/1579)) ([553342c](https://github.com/Gitlawb/openclaude/commit/553342c204b2cc1fafdded7165b9b4e66ebea834))
* **typecheck:** replace dead-code literal comparisons with isAntEmployee() ([#1512](https://github.com/Gitlawb/openclaude/issues/1512)) ([7078853](https://github.com/Gitlawb/openclaude/commit/7078853ea8f5dca2686cf63e019bf047c861e554))
* **typecheck:** restore control protocol type exports ([#1497](https://github.com/Gitlawb/openclaude/issues/1497)) ([3a308c1](https://github.com/Gitlawb/openclaude/commit/3a308c11d44514e6262eb878511efca6d83bbcc7))
* **typecheck:** tighten permission rule UI types ([#1567](https://github.com/Gitlawb/openclaude/issues/1567)) ([6ee24f7](https://github.com/Gitlawb/openclaude/commit/6ee24f78e76fa3f68303561e96975fc25b03f6f5))
* **typecheck:** type beta header accumulator ([#1516](https://github.com/Gitlawb/openclaude/issues/1516)) ([a692fca](https://github.com/Gitlawb/openclaude/commit/a692fca02a0aedb013c0aef89b8972ef14d464f7))
* **typecheck:** type cache-busted credential tests ([#1525](https://github.com/Gitlawb/openclaude/issues/1525)) ([9e942da](https://github.com/Gitlawb/openclaude/commit/9e942da3fbf02816d3113a93988a7ac1cced8174))
* **typecheck:** type Doctor screen state ([#1522](https://github.com/Gitlawb/openclaude/issues/1522)) ([6cb3493](https://github.com/Gitlawb/openclaude/commit/6cb3493d8c5f4ad862d17af9d427bdf69cafebd5))
* **typecheck:** type FileWrite rejection state ([#1574](https://github.com/Gitlawb/openclaude/issues/1574)) ([fba949c](https://github.com/Gitlawb/openclaude/commit/fba949cabf48a9bc352f6c91ad7fe61946bdca32))
* **typecheck:** type Grove dialog state ([#1521](https://github.com/Gitlawb/openclaude/issues/1521)) ([f726685](https://github.com/Gitlawb/openclaude/commit/f726685ff0172800a530ef317962270513926b58))
* **typecheck:** type gRPC stream messages ([#1572](https://github.com/Gitlawb/openclaude/issues/1572)) ([c2cc6ed](https://github.com/Gitlawb/openclaude/commit/c2cc6ed333ba4c095709ae804b0fb222987b6f20))
* **typecheck:** type MCP doctor test fixtures ([#1527](https://github.com/Gitlawb/openclaude/issues/1527)) ([38c0fe4](https://github.com/Gitlawb/openclaude/commit/38c0fe4982cb8e1e387efd69eae7da8f2cd49336))
* **typecheck:** type MCP XAA auth storage ([#1570](https://github.com/Gitlawb/openclaude/issues/1570)) ([bf2d540](https://github.com/Gitlawb/openclaude/commit/bf2d540efc5e7369c8d8466dcb3605608578b9d9))
* **typecheck:** type provider diagnostic tests ([#1517](https://github.com/Gitlawb/openclaude/issues/1517)) ([ebf38f7](https://github.com/Gitlawb/openclaude/commit/ebf38f7819a5c2ba1bf1b5ef7d9f2c1d58d3dc59))
* **typecheck:** type secure storage command output ([#1524](https://github.com/Gitlawb/openclaude/issues/1524)) ([8c2f585](https://github.com/Gitlawb/openclaude/commit/8c2f5859b3c63dd7a2569088877fc31a3ba8b396))
* **typecheck:** type session storage test fixtures ([#1526](https://github.com/Gitlawb/openclaude/issues/1526)) ([491985a](https://github.com/Gitlawb/openclaude/commit/491985a6181a43cb616944ca23144024b86a9ea3))
* **typecheck:** type stats dialog state ([#1569](https://github.com/Gitlawb/openclaude/issues/1569)) ([499c702](https://github.com/Gitlawb/openclaude/commit/499c702bcec3789d59b1c4898e43b5b30d3720e2))
* **typecheck:** type tool test fixtures ([#1518](https://github.com/Gitlawb/openclaude/issues/1518)) ([ddf9282](https://github.com/Gitlawb/openclaude/commit/ddf9282ae31c072a821c909919118157897de054))


### Performance Improvements

* **attachments:** skip skill listings for utility forks ([#1545](https://github.com/Gitlawb/openclaude/issues/1545)) ([2bed184](https://github.com/Gitlawb/openclaude/commit/2bed1849b1a587bda2970cb83f20b326f794aec0))

## [0.17.1](https://github.com/Gitlawb/openclaude/compare/v0.17.0...v0.17.1) (2026-06-05)


### Bug Fixes

* **typecheck:** type GitHub app setup flow ([#1523](https://github.com/Gitlawb/openclaude/issues/1523)) ([80607ca](https://github.com/Gitlawb/openclaude/commit/80607ca1358991ca4d8025213c7c2e26748f2b93))
* **typecheck:** type search UI state ([#1529](https://github.com/Gitlawb/openclaude/issues/1529)) ([47eea3f](https://github.com/Gitlawb/openclaude/commit/47eea3f8b13c85865b84525563b4eaf446c91b6c))

## [0.17.0](https://github.com/Gitlawb/openclaude/compare/v0.16.1...v0.17.0) (2026-06-05)


### Features

* add conversation cache and session persistence ([#705](https://github.com/Gitlawb/openclaude/issues/705)) ([353e306](https://github.com/Gitlawb/openclaude/commit/353e3060644254c331b52fe9d243f97b78c570fe))
* memory optimization to prevent OOM in multi-session scenarios ([#1437](https://github.com/Gitlawb/openclaude/issues/1437)) ([22b1a19](https://github.com/Gitlawb/openclaude/commit/22b1a193f1c34763a5f98c985fc98fccac0109fd))
* **minimax:** add MiniMax M3 model with 1M context window ([#1470](https://github.com/Gitlawb/openclaude/issues/1470)) ([e2fa248](https://github.com/Gitlawb/openclaude/commit/e2fa248376f5242dd01c22c173e1332593bc5b78))
* **nvidia-nim:** dynamic model discovery via integrate.api.nvidia.com ([#1099](https://github.com/Gitlawb/openclaude/issues/1099)) ([#1177](https://github.com/Gitlawb/openclaude/issues/1177)) ([890456b](https://github.com/Gitlawb/openclaude/commit/890456b35e1e6d6a4baf4febc27af610d3f4aaad))
* **opengateway:** add MiniMax M3 and Qwen 3.7 Max to the model catalog ([#1515](https://github.com/Gitlawb/openclaude/issues/1515)) ([8705cd3](https://github.com/Gitlawb/openclaude/commit/8705cd35f72c0804059c3ebbd85b1189f3ea9d07))
* **opengateway:** Gemini 3.1 Flash Lite GA model id ([#1537](https://github.com/Gitlawb/openclaude/issues/1537)) ([ea09176](https://github.com/Gitlawb/openclaude/commit/ea091768ae15e0676ec184b3df841239733e8d97))
* **provider:** auto-switch on rate limit via providerFallbackChain ([#768](https://github.com/Gitlawb/openclaude/issues/768)) ([#1176](https://github.com/Gitlawb/openclaude/issues/1176)) ([cfbce38](https://github.com/Gitlawb/openclaude/commit/cfbce38fe688717f61b48624ea0461cf2c1bb707))
* **sponsors:** add Atlas Cloud sponsor and sponsored tip ([#1536](https://github.com/Gitlawb/openclaude/issues/1536)) ([73a2833](https://github.com/Gitlawb/openclaude/commit/73a2833819aa6cea91871779d9ff2f11e0953e31))
* **xiaomi:** retire deprecated MiMo V2 Pro and V2 Omni ([#1538](https://github.com/Gitlawb/openclaude/issues/1538)) ([b1a8026](https://github.com/Gitlawb/openclaude/commit/b1a80267a5ed108b3700df08e051419d5a2c6fab))


### Bug Fixes

* **api:** tighten reasoning_content heuristic to prevent false-positi… ([#1201](https://github.com/Gitlawb/openclaude/issues/1201)) ([1fc5116](https://github.com/Gitlawb/openclaude/commit/1fc5116e9551948de0d47ea20bdfbd73631dee18))
* **BashTool:** include captured output in non-zero-exit error result ([#1231](https://github.com/Gitlawb/openclaude/issues/1231)) ([#1249](https://github.com/Gitlawb/openclaude/issues/1249)) ([8416faa](https://github.com/Gitlawb/openclaude/commit/8416faa75c1baae5b079e9f4dd7a624a7f6fb6ff))
* **cron:** enforce MAX_CRON_PROMPT_CHARS cap on durable cron prompt l… ([#1224](https://github.com/Gitlawb/openclaude/issues/1224)) ([f7d42c2](https://github.com/Gitlawb/openclaude/commit/f7d42c2b70081f0943cf5ebe08ab0d396cda4b99))
* **plugins:** use mergeHooksSettings in marketplace supplement path ([#1055](https://github.com/Gitlawb/openclaude/issues/1055)) ([#1167](https://github.com/Gitlawb/openclaude/issues/1167)) ([a7fc408](https://github.com/Gitlawb/openclaude/commit/a7fc408779dc6580da8f5a05dee4bcef03ad1446))
* preserve raw mode across component re-renders (issue [#843](https://github.com/Gitlawb/openclaude/issues/843)) ([#1198](https://github.com/Gitlawb/openclaude/issues/1198)) ([3bf6ccd](https://github.com/Gitlawb/openclaude/commit/3bf6ccd6d8f5bc8c1893c2b6fdceec86e084eac1))
* **promptinput:** keep bash-mode `!` out of the local mirror ([#1179](https://github.com/Gitlawb/openclaude/issues/1179)) ([#1182](https://github.com/Gitlawb/openclaude/issues/1182)) ([ad3e208](https://github.com/Gitlawb/openclaude/commit/ad3e2085927f620adf05fa02f81f59d1c17c0d68))
* **security:** prevent CRLF injection, path injection, and error message leakage ([#1477](https://github.com/Gitlawb/openclaude/issues/1477)) ([7278cad](https://github.com/Gitlawb/openclaude/commit/7278cad872dcaca49bb9b4410d00538004dfcf49))
* show all configured Mistral models and fix model selection priority ([#1360](https://github.com/Gitlawb/openclaude/issues/1360)) ([#1418](https://github.com/Gitlawb/openclaude/issues/1418)) ([7df7cad](https://github.com/Gitlawb/openclaude/commit/7df7cad33345d2724cbff88e68a51c9dac26f306))
* show vision-specific error when provider returns 404 for image requests ([#1187](https://github.com/Gitlawb/openclaude/issues/1187)) ([8801a4c](https://github.com/Gitlawb/openclaude/commit/8801a4cd644d3e9ac1e8f91256307f7ee891172e))
* **test:** stop use-input test from leaking a global stdin mock ([#1501](https://github.com/Gitlawb/openclaude/issues/1501)) ([96ddec7](https://github.com/Gitlawb/openclaude/commit/96ddec71835dab350a5f6de399e819d8060c60c9))
* **typecheck:** make session history cache variant-safe ([#1494](https://github.com/Gitlawb/openclaude/issues/1494)) ([e7abb81](https://github.com/Gitlawb/openclaude/commit/e7abb8146f9d8841c3e59aff7f4dd066ced3851b))
* **typecheck:** narrow hook event counts ([#1496](https://github.com/Gitlawb/openclaude/issues/1496)) ([11e46af](https://github.com/Gitlawb/openclaude/commit/11e46affd10ab3412e1617aca08aed182bb3328d))
* **typecheck:** restore AppState hook generics ([#1503](https://github.com/Gitlawb/openclaude/issues/1503)) ([343cd1a](https://github.com/Gitlawb/openclaude/commit/343cd1a2c93208429d9e02817aafea996ab19117))
* **typecheck:** restore proactive module import surface ([#1495](https://github.com/Gitlawb/openclaude/issues/1495)) ([e357d59](https://github.com/Gitlawb/openclaude/commit/e357d593e0b90584aec0ec83f3adf5c845487a4a))
* **typecheck:** restore typed add-dir source ([#1504](https://github.com/Gitlawb/openclaude/issues/1504)) ([2c755d3](https://github.com/Gitlawb/openclaude/commit/2c755d3da83ab1b48dfb5d5c048a682ae1325a77))
* use mistral-vibe-cli-latest as default model for Mistral AI ([#1188](https://github.com/Gitlawb/openclaude/issues/1188)) ([671faf2](https://github.com/Gitlawb/openclaude/commit/671faf23ab4d34383bc6f3b62ce4d0363d0f216b))
* **vscode:** send schema-valid permission responses ([#1401](https://github.com/Gitlawb/openclaude/issues/1401)) ([8065f8d](https://github.com/Gitlawb/openclaude/commit/8065f8d37b2cdfafe0833288e9150ff3af5ba2af))

## [0.16.1](https://github.com/Gitlawb/openclaude/compare/v0.16.0...v0.16.1) (2026-06-01)


### Bug Fixes

* **ci:** build before unit tests in release workflow ([#1463](https://github.com/Gitlawb/openclaude/issues/1463)) ([d35d468](https://github.com/Gitlawb/openclaude/commit/d35d4687ad33388f87f43652919ce3ea96dd7435))

## [0.16.0](https://github.com/Gitlawb/openclaude/compare/v0.15.0...v0.16.0) (2026-05-31)


### Features

* **doctor:** warn local-model users about large context contributors ([#1238](https://github.com/Gitlawb/openclaude/issues/1238)) ([11f0e02](https://github.com/Gitlawb/openclaude/commit/11f0e02b6327f333d60f8f36e872e03d2e358be1))
* enable MCP_SKILLS — discover skill:// resources as invocable skills ([#1408](https://github.com/Gitlawb/openclaude/issues/1408)) ([f111eaa](https://github.com/Gitlawb/openclaude/commit/f111eaa1b33a6dc3946f17af0d51cc5048ebc88c))
* **provider:** add OpenCode Zen/Go subscription support ([#1350](https://github.com/Gitlawb/openclaude/issues/1350)) ([5a22d60](https://github.com/Gitlawb/openclaude/commit/5a22d604f83fc68fcb2e6f41ca3586ab5044df1d))
* set process.title to 'openclaude' ([#1425](https://github.com/Gitlawb/openclaude/issues/1425)) ([f6d7a58](https://github.com/Gitlawb/openclaude/commit/f6d7a5894b20fa1aaeafd4b6e0102c3632a69895))


### Bug Fixes

* **agents:** route configured agent model overrides ([#1390](https://github.com/Gitlawb/openclaude/issues/1390)) ([a8632b4](https://github.com/Gitlawb/openclaude/commit/a8632b4cc3e77aebbcf332a235109f22eeb720bd))
* **autocompact:** retry circuit breaker after cooldown ([#1375](https://github.com/Gitlawb/openclaude/issues/1375)) ([11d59ec](https://github.com/Gitlawb/openclaude/commit/11d59ecdcb4f583a629c370a1ee9dd5e9129ce03))
* **bash:** show output for ! shell commands ([#1265](https://github.com/Gitlawb/openclaude/issues/1265)) ([#1395](https://github.com/Gitlawb/openclaude/issues/1395)) ([ac3ae10](https://github.com/Gitlawb/openclaude/commit/ac3ae109363e59df13c981646e8683192b7a6de2))
* **build:** restore /dream slash command in bundled CLI ([#1399](https://github.com/Gitlawb/openclaude/issues/1399)) ([132539f](https://github.com/Gitlawb/openclaude/commit/132539ff79f6e1eab05f94aafb3f84db644b26fc))
* **ci:** scan PR head for intent checks ([#1461](https://github.com/Gitlawb/openclaude/issues/1461)) ([276ec6a](https://github.com/Gitlawb/openclaude/commit/276ec6ab0efb5c8d93cf5c522d5b88f9787235fb))
* **docs:** update Xiaomi MiMo API URL in README. ([#1424](https://github.com/Gitlawb/openclaude/issues/1424)) ([7cc8eda](https://github.com/Gitlawb/openclaude/commit/7cc8edaa3c0d307a90ee530a253411973ed9cdc3))
* **fork:** render forked-worker messages, drop unmirrored /fork command ([#1451](https://github.com/Gitlawb/openclaude/issues/1451)) ([b900364](https://github.com/Gitlawb/openclaude/commit/b900364dbef182dbbf5522043a4fdd1c8750cb72))
* **ink:** correct stringWidth JS fallback for symbol characters ([#1244](https://github.com/Gitlawb/openclaude/issues/1244)) ([83abfa5](https://github.com/Gitlawb/openclaude/commit/83abfa506ab19676722c5dff09ce68f658af32a7))
* **launcher:** route direct Node launch paths through launcher ([#1363](https://github.com/Gitlawb/openclaude/issues/1363)) ([363583f](https://github.com/Gitlawb/openclaude/commit/363583faf55bf3cf01a712e78f03f633269451ef))
* **loader:** batch markdown reads + cap file size to unblock startup ([#1240](https://github.com/Gitlawb/openclaude/issues/1240)) ([bfb0667](https://github.com/Gitlawb/openclaude/commit/bfb0667601cde541e8ee8a472a91d786ed045a21))
* **ollama:** cap deepseek v4 pro cloud output tokens ([#1348](https://github.com/Gitlawb/openclaude/issues/1348)) ([8dd7cb0](https://github.com/Gitlawb/openclaude/commit/8dd7cb066a67db0a69deff3ce68247ec26be0142))
* **onboarding:** bound preflight probe + recover from connectivity failure ([#1017](https://github.com/Gitlawb/openclaude/issues/1017)) ([#1400](https://github.com/Gitlawb/openclaude/issues/1400)) ([c5ca847](https://github.com/Gitlawb/openclaude/commit/c5ca8476596ffb53a14d596ae55c1a95054921a7))
* **provider:** allow remote Ollama without OPENAI_API_KEY ([#952](https://github.com/Gitlawb/openclaude/issues/952)) ([01ffbb6](https://github.com/Gitlawb/openclaude/commit/01ffbb68b8db8221c2e800067d8a7c6bf17d30d2)), closes [#369](https://github.com/Gitlawb/openclaude/issues/369)
* **provider:** require API key input when adding OpenGateway ([#1384](https://github.com/Gitlawb/openclaude/issues/1384)) ([7c23fb7](https://github.com/Gitlawb/openclaude/commit/7c23fb7a050f56089e41e3492e58dc2ad3a3748f))
* **query:** keep tool failure guard across unrelated successes ([#1277](https://github.com/Gitlawb/openclaude/issues/1277)) ([cf305cc](https://github.com/Gitlawb/openclaude/commit/cf305ccc291f81fd962c3644e765b2d560678a1b))
* **release:** verify npm latest tag and document [@latest](https://github.com/latest) install ([#1378](https://github.com/Gitlawb/openclaude/issues/1378)) ([f3d41c6](https://github.com/Gitlawb/openclaude/commit/f3d41c6161db84acae464d4eaf9ad07093effe8b))
* **repl:** show permission prompts while draft input is present ([#1393](https://github.com/Gitlawb/openclaude/issues/1393)) ([70b4b07](https://github.com/Gitlawb/openclaude/commit/70b4b07908d98fd938ae338ca0bad60a80f36587)), closes [#651](https://github.com/Gitlawb/openclaude/issues/651)
* **sandbox:** guard annotateStderrWithSandboxFailures against missing runtime method (fixes Bash on builds without sandbox-runtime) ([#1452](https://github.com/Gitlawb/openclaude/issues/1452)) ([479b0e8](https://github.com/Gitlawb/openclaude/commit/479b0e8226005e4eb24bb090bfb527a483039e4c))
* **teammate-progress:** keep cumulative token+tool counts across prompts ([#475](https://github.com/Gitlawb/openclaude/issues/475)) ([#1402](https://github.com/Gitlawb/openclaude/issues/1402)) ([5247fb8](https://github.com/Gitlawb/openclaude/commit/5247fb897742d6134fd8ab97594f2c10dba336f9))
* **test:** prevent providerProfiles config mock from leaking across files ([#1432](https://github.com/Gitlawb/openclaude/issues/1432)) ([690b3f0](https://github.com/Gitlawb/openclaude/commit/690b3f07a40cec5f8f82a292e81c4c84c6926888))
* **thinking:** disable thinking for unsupported Ollama models ([#1376](https://github.com/Gitlawb/openclaude/issues/1376)) ([8513178](https://github.com/Gitlawb/openclaude/commit/85131789346f5b5e067189786e43535fbe04c20d))
* third-party provider compat — update, metrics, and refusal message ([#1406](https://github.com/Gitlawb/openclaude/issues/1406)) ([dda5ea3](https://github.com/Gitlawb/openclaude/commit/dda5ea31bd3d08db12cd2973560b008f71888663))

## [0.15.0](https://github.com/Gitlawb/openclaude/compare/v0.14.0...v0.15.0) (2026-05-26)


### Features

* **agents:** set active session agent from agents menu ([#1349](https://github.com/Gitlawb/openclaude/issues/1349)) ([7419d38](https://github.com/Gitlawb/openclaude/commit/7419d3800ca68c306df38173d6e9f5892ba85c50))
* configure API retry backoff ([#370](https://github.com/Gitlawb/openclaude/issues/370)) ([#1095](https://github.com/Gitlawb/openclaude/issues/1095)) ([d02c10b](https://github.com/Gitlawb/openclaude/commit/d02c10b399a9e30a7018646ad0c24d14f35bff13))
* **query:** robust multi-lingual and structural continuation nudge ([#1280](https://github.com/Gitlawb/openclaude/issues/1280)) ([2f8aa50](https://github.com/Gitlawb/openclaude/commit/2f8aa50cf6f87e3c64f7cf3cc07a351a22f7f950))
* **safety:** warn at startup when 3P provider + permissive mode skip the AI classifier ([#1260](https://github.com/Gitlawb/openclaude/issues/1260)) ([4e8fa24](https://github.com/Gitlawb/openclaude/commit/4e8fa24cce5de07052632d5a8a7fb4474217eab8))


### Bug Fixes

* **agent:** allow custom model overrides ([#1337](https://github.com/Gitlawb/openclaude/issues/1337)) ([785d3de](https://github.com/Gitlawb/openclaude/commit/785d3de2cd7293bdde224eaf5e9f41d275cf346b))
* **attribution:** make git attribution opt-in by default ([#1335](https://github.com/Gitlawb/openclaude/issues/1335)) ([6bc050e](https://github.com/Gitlawb/openclaude/commit/6bc050e621ac8712cd919e2e2b897ebb68b7bd67))
* **codex-stream:** recover tool args delivered only via done events ([#1262](https://github.com/Gitlawb/openclaude/issues/1262)) ([2d26a46](https://github.com/Gitlawb/openclaude/commit/2d26a4673a565301a3ee00e33e26059f37b7d44a)), closes [#1259](https://github.com/Gitlawb/openclaude/issues/1259)
* **codex:** allow credential storage fallback ([#1347](https://github.com/Gitlawb/openclaude/issues/1347)) ([f15d236](https://github.com/Gitlawb/openclaude/commit/f15d2360eeb521c19b5449df5ddd5c7cfc5639a1))
* **json-schema:** support top-level non-object roots via wrap/unwrap ([#1261](https://github.com/Gitlawb/openclaude/issues/1261)) ([07d9b4f](https://github.com/Gitlawb/openclaude/commit/07d9b4fec49dcbae67ac721ac581f4e1b3c6a4fb)), closes [#1256](https://github.com/Gitlawb/openclaude/issues/1256)
* **model:** include profile models in descriptor picker ([#1361](https://github.com/Gitlawb/openclaude/issues/1361)) ([2c87bfe](https://github.com/Gitlawb/openclaude/commit/2c87bfe055ae9bd95a297c21de9c3eee332c4337))
* route MiniMax compacting through Anthropic-compatible API ([#1154](https://github.com/Gitlawb/openclaude/issues/1154)) ([b3dc674](https://github.com/Gitlawb/openclaude/commit/b3dc674dbea8e1a740832fdde54d8fd820d501bd))
* **watchers:** debounce skills and settings reload bursts ([#1370](https://github.com/Gitlawb/openclaude/issues/1370)) ([ed91673](https://github.com/Gitlawb/openclaude/commit/ed91673f53718bca95bf31e8f0851335df020189))

## [0.14.0](https://github.com/Gitlawb/openclaude/compare/v0.13.0...v0.14.0) (2026-05-23)


### Features

* **diagnostics:** show request payload size breakdown ([#1237](https://github.com/Gitlawb/openclaude/issues/1237)) ([0aff8de](https://github.com/Gitlawb/openclaude/commit/0aff8de24f00c6cf6f1218c88b841c219c8f5a7d))
* **opengateway:** require API key on /v1/* and switch to bearer auth ([#1322](https://github.com/Gitlawb/openclaude/issues/1322)) ([0fbfc12](https://github.com/Gitlawb/openclaude/commit/0fbfc12a992883843c597ed2cf14f548dafc3975))
* **xai:** add xAI/Grok OAuth provider (browser + device-code) ([#1284](https://github.com/Gitlawb/openclaude/issues/1284)) ([326f082](https://github.com/Gitlawb/openclaude/commit/326f0826821d8e968eef4872910d3b1ffbda174a))


### Bug Fixes

* add 5-minute timeout to QueryGuard to prevent infinite spinner ([#1255](https://github.com/Gitlawb/openclaude/issues/1255)) ([23254c2](https://github.com/Gitlawb/openclaude/commit/23254c21fbb6eb6e443a575c7a662121bdb9aa13))
* allow non-OpenAI providers to skip OPENAI_API_KEY check ([#1207](https://github.com/Gitlawb/openclaude/issues/1207)) ([4897d59](https://github.com/Gitlawb/openclaude/commit/4897d597b6aadd99633a854d15e62a95a8c9907b))
* **bash:** preserve captured stdout in error message on non-zero exit ([#1236](https://github.com/Gitlawb/openclaude/issues/1236)) ([a44a83f](https://github.com/Gitlawb/openclaude/commit/a44a83f38c7156ab47c2d533abf48d18999b9239))
* **compact:** clear native tool results after time compaction ([#1278](https://github.com/Gitlawb/openclaude/issues/1278)) ([9b3c904](https://github.com/Gitlawb/openclaude/commit/9b3c90418bded3dd9cca561ecd4683fa059d19e9))
* **grpc:** register built-in agents so Agent tool isn't always empty ([#1296](https://github.com/Gitlawb/openclaude/issues/1296)) ([c366f70](https://github.com/Gitlawb/openclaude/commit/c366f7062b8f8c45c462a48a27e847413f66d9da))
* harden XAA OAuth callback state handling ([#1299](https://github.com/Gitlawb/openclaude/issues/1299)) ([bafc2a1](https://github.com/Gitlawb/openclaude/commit/bafc2a1bc53f23d2a38318d91f2a3ffdb78fb091))
* **input:** preserve split utf8 keypresses ([#1241](https://github.com/Gitlawb/openclaude/issues/1241)) ([a9f8642](https://github.com/Gitlawb/openclaude/commit/a9f8642aa8e30163f4818e08a27cdd11866eaf2f))
* MiMo remove unsupported body fields and preserve reasoning content ([#1253](https://github.com/Gitlawb/openclaude/issues/1253)) ([aab2fbc](https://github.com/Gitlawb/openclaude/commit/aab2fbcd7bcb8be3b6e288822917a577bc89b8fc))
* **monitor:** close permission dialog after selection ([#1225](https://github.com/Gitlawb/openclaude/issues/1225)) ([1aa8aab](https://github.com/Gitlawb/openclaude/commit/1aa8aab84c044347c4c2ae5b4333079165105006))
* **query:** stop repeated tool-failure loops ([#1219](https://github.com/Gitlawb/openclaude/issues/1219)) ([f71e769](https://github.com/Gitlawb/openclaude/commit/f71e7692373a61d28c82fc3fadff3feaa4071ede))
* **recovery:** keep thinking blocks on resume for reasoning-echo providers ([#1248](https://github.com/Gitlawb/openclaude/issues/1248)) ([0d3c157](https://github.com/Gitlawb/openclaude/commit/0d3c1571491b7dfeb07d5311167c2509978feb30))
* **retry:** adjust max_tokens on OpenRouter 402 credit shortfall ([#1263](https://github.com/Gitlawb/openclaude/issues/1263)) ([892c054](https://github.com/Gitlawb/openclaude/commit/892c0545ed23ee685dd5a0a0104398fa3a221181)), closes [#1125](https://github.com/Gitlawb/openclaude/issues/1125)
* **stdin,mcp:** guard rawModeEnabledCount and defer MCP connections to prevent input freeze ([#603](https://github.com/Gitlawb/openclaude/issues/603)) ([#1268](https://github.com/Gitlawb/openclaude/issues/1268)) ([90360d3](https://github.com/Gitlawb/openclaude/commit/90360d3e383314304dc19b29bd786b59e966be15))
* **TaskListV2:** revert overflowX hidden that hides task text labels ([#1215](https://github.com/Gitlawb/openclaude/issues/1215)) ([0fba154](https://github.com/Gitlawb/openclaude/commit/0fba1541a8647a805339811f6f2bac4b8d13b699))
* treat blank Read.pages as omitted ([#1269](https://github.com/Gitlawb/openclaude/issues/1269)) ([eca9dba](https://github.com/Gitlawb/openclaude/commit/eca9dba3999bb538fcd732a3cf9a50503a214312))
* **xml:** guard escapeXml/escapeXmlAttr against null and undefined ([#1250](https://github.com/Gitlawb/openclaude/issues/1250)) ([03f8791](https://github.com/Gitlawb/openclaude/commit/03f879158c6c64321b9d0703d84c0b1c47d64a52))

## [0.13.0](https://github.com/Gitlawb/openclaude/compare/v0.12.1...v0.13.0) (2026-05-17)


### Features

* **export:** add Markdown and JSON conversation exports ([#1193](https://github.com/Gitlawb/openclaude/issues/1193)) ([271bad4](https://github.com/Gitlawb/openclaude/commit/271bad4209563176ff240c89535cbb64990c23ff))


### Bug Fixes

* **bashPermissions:** apply MAX_SUBCOMMANDS cap in sandbox auto-allow path ([#1057](https://github.com/Gitlawb/openclaude/issues/1057)) ([#1166](https://github.com/Gitlawb/openclaude/issues/1166)) ([c53ef18](https://github.com/Gitlawb/openclaude/commit/c53ef1871627a4497c042199449f4f538a9c6ffa))
* **gemini:** parse raw tool call text ([#1212](https://github.com/Gitlawb/openclaude/issues/1212)) ([2d20109](https://github.com/Gitlawb/openclaude/commit/2d20109edc8b238d7c6118ab9c5a4126ad0726bc))
* **spinner:** prevent layout shift during thinking and orphaned task icons ([#1211](https://github.com/Gitlawb/openclaude/issues/1211)) ([8470832](https://github.com/Gitlawb/openclaude/commit/8470832e5c705d98dc0ec50066be3537c8a1b589))
* **websearch:** surface adapter failure when auto mode falls back to native ([#994](https://github.com/Gitlawb/openclaude/issues/994)) ([#1168](https://github.com/Gitlawb/openclaude/issues/1168)) ([b3b7714](https://github.com/Gitlawb/openclaude/commit/b3b771476d8c3678c0225b32515e02c1dd730571))

## [0.12.1](https://github.com/Gitlawb/openclaude/compare/v0.12.0...v0.12.1) (2026-05-16)


### Bug Fixes

* **entrypoint:** apply --max-old-space-size=8192 universally, not just CCR ([#1191](https://github.com/Gitlawb/openclaude/issues/1191)) ([4d0603e](https://github.com/Gitlawb/openclaude/commit/4d0603e9906b24d0f4f3fc683db1950879875e16))
* **gemini:** preserve tool calls through opengateway ([#1204](https://github.com/Gitlawb/openclaude/issues/1204)) ([13a0901](https://github.com/Gitlawb/openclaude/commit/13a090162f9b0c53080aaaa1cfa937cd9981596e))

## [0.12.0](https://github.com/Gitlawb/openclaude/compare/v0.11.0...v0.12.0) (2026-05-16)


### Features

* **opengateway:** add Gemini 3.1 Flash Lite + GLM 5.1 FP8 to catalog ([#1194](https://github.com/Gitlawb/openclaude/issues/1194)) ([4d04f5b](https://github.com/Gitlawb/openclaude/commit/4d04f5bf4f1acc9d3cc00dab0b1b697e13711207))


### Bug Fixes

* **openai-shim:** surface in-stream errors and truncation hints ([#1174](https://github.com/Gitlawb/openclaude/issues/1174)) ([6174d75](https://github.com/Gitlawb/openclaude/commit/6174d75e983e80601ba369a595d7b64580e3bd51))
* Reduce stable stringify heap usage ([#1104](https://github.com/Gitlawb/openclaude/issues/1104)) ([c433d20](https://github.com/Gitlawb/openclaude/commit/c433d20fdc5666736c800a942bbcc0f0d85cc296))

## [0.11.0](https://github.com/Gitlawb/openclaude/compare/v0.10.0...v0.11.0) (2026-05-14)


### Features

* add sponsored tips with frequency-gated display ([#1140](https://github.com/Gitlawb/openclaude/issues/1140)) ([a4cbb78](https://github.com/Gitlawb/openclaude/commit/a4cbb785854619689dbedcec54b6b7739529fdd0))
* **groq:** dynamic model discovery with mapModel filtering and hybrid catalog ([#1143](https://github.com/Gitlawb/openclaude/issues/1143)) ([a65bdb4](https://github.com/Gitlawb/openclaude/commit/a65bdb41b84e7454ef2f50921ea56f04464f0455))
* implement high-performance SQLite storage layer with JSON audit log (Phase 2 Masterpiece) ([#1106](https://github.com/Gitlawb/openclaude/issues/1106)) ([e12432e](https://github.com/Gitlawb/openclaude/commit/e12432eaf68be2ded987f83b16f1d4ae994d4d2b))
* **nvidia-nim:** add latest chat models, remove duplicate Mixtral 8x22B entry. Verified against integrate.api.nvidia.com/v1/models on 2026-05-13. Tracks [#1099](https://github.com/Gitlawb/openclaude/issues/1099). ([#1145](https://github.com/Gitlawb/openclaude/issues/1145)) ([0f6668f](https://github.com/Gitlawb/openclaude/commit/0f6668f554a9ed687095a3ce244fdf246cfe884c))
* **provider:** add Gitlawb Opengateway as default provider with MiMo ([#1165](https://github.com/Gitlawb/openclaude/issues/1165)) ([5b5ba88](https://github.com/Gitlawb/openclaude/commit/5b5ba8853bd8b3d922b957a96484e1092cd3a6a3))
* **provider:** add Venice official provider ([#1109](https://github.com/Gitlawb/openclaude/issues/1109)) ([f9621ab](https://github.com/Gitlawb/openclaude/commit/f9621ab575762453bff5d224e1e6f44067d9b1f3))
* **provider:** add Xiaomi MiMo integration ([#1152](https://github.com/Gitlawb/openclaude/issues/1152)) ([18483e4](https://github.com/Gitlawb/openclaude/commit/18483e4d96e9763993af116112a0fee4877a1227))


### Bug Fixes

* **agent:** prevent mid-flight peeking and taking over of forks ([#1153](https://github.com/Gitlawb/openclaude/issues/1153)) ([74e3947](https://github.com/Gitlawb/openclaude/commit/74e3947d881802420b860f1e6b9f156fecdd65d7))
* **bashPermissions:** block command substitution in array subscript position ([#1111](https://github.com/Gitlawb/openclaude/issues/1111)) ([4a98a4a](https://github.com/Gitlawb/openclaude/commit/4a98a4a227d148a3ff0ac05f20f32a0f7888a5be))
* **bashSecurity:** tighten fc -e detection to avoid long-flag false positives ([#1107](https://github.com/Gitlawb/openclaude/issues/1107)) ([0c88def](https://github.com/Gitlawb/openclaude/commit/0c88defbe0014f434b6ae5d419c8a6234463294e))
* **codex:** normalize empty MCP object schemas ([#1121](https://github.com/Gitlawb/openclaude/issues/1121)) ([7ea74f2](https://github.com/Gitlawb/openclaude/commit/7ea74f29f0cf01654da37deef52d9350a34b6c89))
* **errors:** surface re-auth hint on OAuth token expiry 401s ([#1042](https://github.com/Gitlawb/openclaude/issues/1042)) ([#1142](https://github.com/Gitlawb/openclaude/issues/1142)) ([921594e](https://github.com/Gitlawb/openclaude/commit/921594efc46792d2af969ab948a2ccde3c64e062))
* hide missing-module slash command stubs ([#1136](https://github.com/Gitlawb/openclaude/issues/1136)) ([cf33f03](https://github.com/Gitlawb/openclaude/commit/cf33f0375543afc26492426f55f8d81647288e79))
* **integrations:** cap gpt-5.5 context window at Codex effective limit ([#1118](https://github.com/Gitlawb/openclaude/issues/1118)) ([#1141](https://github.com/Gitlawb/openclaude/issues/1141)) ([cac11dc](https://github.com/Gitlawb/openclaude/commit/cac11dce0d5b3850c0f338fda0bbb15ba25f6aa3))
* replace raw abort signal timeouts ([#1123](https://github.com/Gitlawb/openclaude/issues/1123)) ([877b4dc](https://github.com/Gitlawb/openclaude/commit/877b4dc88600062d8bbfaf764bfbd828c55699e8))
* surface actionable error when fetch fails in _doOpenAIRequest ([#447](https://github.com/Gitlawb/openclaude/issues/447)) ([3af0924](https://github.com/Gitlawb/openclaude/commit/3af092441d36d77cc5b23c69225be568ef8d355c))
* update vulnerable dependencies ([#1149](https://github.com/Gitlawb/openclaude/issues/1149)) ([5328f57](https://github.com/Gitlawb/openclaude/commit/5328f57a724b15fcf688cdfd0c1d52c3de926059))

## [0.10.0](https://github.com/Gitlawb/openclaude/compare/v0.9.2...v0.10.0) (2026-05-11)


### Features

* Add startup logo palette picker ([#1072](https://github.com/Gitlawb/openclaude/issues/1072)) ([ed7b697](https://github.com/Gitlawb/openclaude/commit/ed7b6972f9cd7d36cd604738f5160064061ab254))
* **cli:** honor --model alone without requiring --provider ([#854](https://github.com/Gitlawb/openclaude/issues/854)) ([7cfc8d5](https://github.com/Gitlawb/openclaude/commit/7cfc8d5dad1aa3be247c3197e3442d9f70691db1))
* incremental and cached token counting ([#795](https://github.com/Gitlawb/openclaude/issues/795)) ([4b1e516](https://github.com/Gitlawb/openclaude/commit/4b1e516fc70c07da6ad678df35030fa114cc8918))
* **knowledge:** introduce local Orama persistence (feature-flagged) ([#1015](https://github.com/Gitlawb/openclaude/issues/1015)) ([5873bc6](https://github.com/Gitlawb/openclaude/commit/5873bc67141b6345d0630112a84d7fcfb149b584))
* make Orama the default search engine with JSON-backed ([#1094](https://github.com/Gitlawb/openclaude/issues/1094)) ([f443669](https://github.com/Gitlawb/openclaude/commit/f4436697f02cc626bb55c3c4db1cd86938471e37))
* **websearch:** add first-class Brave adapter; fix Google + Brave presets; restore Exa snippets ([#1044](https://github.com/Gitlawb/openclaude/issues/1044)) ([402cd3d](https://github.com/Gitlawb/openclaude/commit/402cd3dbe81835cc6a658b31355d16697f9e6346))


### Bug Fixes

* **agent:** ensure main agent waits for subagent completion ([#1032](https://github.com/Gitlawb/openclaude/issues/1032)) ([6af709e](https://github.com/Gitlawb/openclaude/commit/6af709e65ea61e9071cbccbdcd7c57fe87b0710e))
* **agents:** coerce non-string whenToUse to prevent crash on save ([#1086](https://github.com/Gitlawb/openclaude/issues/1086)) ([#1087](https://github.com/Gitlawb/openclaude/issues/1087)) ([fc89767](https://github.com/Gitlawb/openclaude/commit/fc8976708b9648bb021bc80270eb9e1d416bef37))
* **bashSecurity:** reject nested heredoc ranges in stripSafeHeredocSubstitutions ([#1050](https://github.com/Gitlawb/openclaude/issues/1050)) ([ebc9c70](https://github.com/Gitlawb/openclaude/commit/ebc9c70bb5eb7224ff94604b662d5285377ee18a))
* **effort:** persist xhigh and send reasoning_effort on chat_completions ([#857](https://github.com/Gitlawb/openclaude/issues/857)) ([feb5791](https://github.com/Gitlawb/openclaude/commit/feb579132016ef73dfaa5f20c073fcd3c91ecd80))
* **openai-shim:** redact ?auth=, ?passwd=, ?pwd= in diagnostic URLs ([#1070](https://github.com/Gitlawb/openclaude/issues/1070)) ([20bc6ae](https://github.com/Gitlawb/openclaude/commit/20bc6aec21a11bde4d2357c2ce45d97233be09b9)), closes [#1069](https://github.com/Gitlawb/openclaude/issues/1069)
* **openai-shim:** strip `store` for local providers (vLLM, custom) ([#1048](https://github.com/Gitlawb/openclaude/issues/1048)) ([4830d6f](https://github.com/Gitlawb/openclaude/commit/4830d6f778c57ae83c12aeda65108e1f5e23acaf))
* **openai-shim:** strip `store` when baseUrl points at Cerebras ([#1040](https://github.com/Gitlawb/openclaude/issues/1040)) ([0adf97d](https://github.com/Gitlawb/openclaude/commit/0adf97dc14f149eb4bcdd0cefcf45dd87eae4f2a))
* replace unsupported Unicode glyphs with widely available alternatives ([#1088](https://github.com/Gitlawb/openclaude/issues/1088)) ([e1e277a](https://github.com/Gitlawb/openclaude/commit/e1e277a3af7217822d41e5b9dc919033d0839db8))
* resolve two bugs making interactive mode unusable with plugin ecosystems ([#825](https://github.com/Gitlawb/openclaude/issues/825)) ([#830](https://github.com/Gitlawb/openclaude/issues/830)) ([e438c89](https://github.com/Gitlawb/openclaude/commit/e438c89fbceefcfb86a8ecdaae6d5a119a92a33b))
* validate plugin component paths ([#1096](https://github.com/Gitlawb/openclaude/issues/1096)) ([9fed6ae](https://github.com/Gitlawb/openclaude/commit/9fed6ae4a0158695719d5ee58b453dc8c6019c0c))


### Performance Improvements

* **local:** add OPENCLAUDE_LOCAL_FAST_PATH to skip cloud-only transforms ([#1068](https://github.com/Gitlawb/openclaude/issues/1068)) ([4fad5d2](https://github.com/Gitlawb/openclaude/commit/4fad5d25dadbaee3712a2dd3749d1a9e8363a0b7)), closes [#1016](https://github.com/Gitlawb/openclaude/issues/1016)

## [0.9.2](https://github.com/Gitlawb/openclaude/compare/v0.9.1...v0.9.2) (2026-05-06)


### Bug Fixes

* **cli:** replace createRequire with static import for teammate.js ([#1026](https://github.com/Gitlawb/openclaude/issues/1026)) ([#1033](https://github.com/Gitlawb/openclaude/issues/1033)) ([c873725](https://github.com/Gitlawb/openclaude/commit/c873725d901c9fd612140603da964894ef69e510))

## [0.9.1](https://github.com/Gitlawb/openclaude/compare/v0.9.0...v0.9.1) (2026-05-05)


### Bug Fixes

* **theme:** remove stale memo wrappers from theme context hooks ([#534](https://github.com/Gitlawb/openclaude/issues/534)) ([094f04c](https://github.com/Gitlawb/openclaude/commit/094f04c8036200eb3c51b7b7b4ec3c75ee83b3a0))

## [0.9.0](https://github.com/Gitlawb/openclaude/compare/v0.8.0...v0.9.0) (2026-05-05)


### Features

* context partitioning and relevance-based pruning ([#849](https://github.com/Gitlawb/openclaude/issues/849)) ([ca676af](https://github.com/Gitlawb/openclaude/commit/ca676affc47dca7f2a65fa867410931e27ae4969))
* rework release notes around GitHub releases ([#981](https://github.com/Gitlawb/openclaude/issues/981)) ([d948769](https://github.com/Gitlawb/openclaude/commit/d948769dd59c5533fa9769c0f16de783010b4620))
* SDK Runtime — Query Engine, Sessions, and Build Pipeline ([#984](https://github.com/Gitlawb/openclaude/issues/984)) ([60c76b6](https://github.com/Gitlawb/openclaude/commit/60c76b6599f691781ad5ae7dfeb6e4029b679d0a))
* support self-hosted Firecrawl via FIRECRAWL_API_URL ([#949](https://github.com/Gitlawb/openclaude/issues/949)) ([a133e76](https://github.com/Gitlawb/openclaude/commit/a133e7631a7c0b6eeb624d60567147cab1257ff0))


### Bug Fixes

* **groq:** strip unsupported store field ([#983](https://github.com/Gitlawb/openclaude/issues/983)) ([6d0953a](https://github.com/Gitlawb/openclaude/commit/6d0953a79cb435b17ed231019fa0b660b770c914))
* **mcp:** allow third-party providers to approve project-scope .mcp.json servers ([#696](https://github.com/Gitlawb/openclaude/issues/696)) ([#937](https://github.com/Gitlawb/openclaude/issues/937)) ([dc3c065](https://github.com/Gitlawb/openclaude/commit/dc3c065c4a70663978f965d50846ba6a0692e59d))
* **shims:** strip x-anthropic-billing-header block before forwarding system prompt ([#1019](https://github.com/Gitlawb/openclaude/issues/1019)) ([40ae1e7](https://github.com/Gitlawb/openclaude/commit/40ae1e720034f00912762d5e723903d3170bc396))
* **startup:** make CLAUDE logo D distinct ([#986](https://github.com/Gitlawb/openclaude/issues/986)) ([35f86a9](https://github.com/Gitlawb/openclaude/commit/35f86a9580aedd3f359dfc13992e49f2ec53757e))
* **tests:** resolve flakiness due to module leak and env state leakage ([#988](https://github.com/Gitlawb/openclaude/issues/988)) ([990a5a2](https://github.com/Gitlawb/openclaude/commit/990a5a2afbb22b8f9274328783a6adbda1a3b62c))
* **web-search:** surface diagnostic when adapter returns 0 hits and no native fallback ([#1006](https://github.com/Gitlawb/openclaude/issues/1006)) ([1c74675](https://github.com/Gitlawb/openclaude/commit/1c746750f67d576b8272ba985b65c9c4406bdbc9))

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
