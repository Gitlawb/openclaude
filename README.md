# Hack_Agent / OpenClaude（安全向分叉）

面向**授权范围内的网络安全工作**的终端 Agent：在 [OpenClaude](https://github.com/Gitlawb/openclaude) 多模型 CLI 之上，默认启用 **pentest 提示词配置**、内置 **RAG** 与 **渗透 Web 控制台**（任务/Worker/RAG 同源状态）。

**仓库：** [github.com/Gi1gamesh666/Hack_Agent](https://github.com/Gi1gamesh666/Hack_Agent)（主开发分支示例：`claude-agent`）

## 功能概览

| 能力 | 说明 |
| --- | --- |
| 多模型后端 | 与上游一致：OpenAI 兼容、Gemini、Ollama 等，见 `/provider` |
| 默认安全专家人设 | `OPENCLAUDE_PROMPT_PROFILE` 默认为 `pentest`，系统提示为「网络安全全能专家」 |
| 混合 RAG | 数据在 `~/.openclaude/pentest/rag.sqlite`，每轮按需注入 system |
| 斜杠命令 | `/rag-add`、`/rag-delete`、`/rag-list`、`/rag-rebuild`、`/rag-query`（别名 `/rag/…`） |
| Pentest Web | `/pentest-web` 启动内置 HTTP 面板（任务、Worker、RAG 上传/检索等） |

## 环境变量（常用）

| 变量 | 作用 |
| --- | --- |
| `OPENCLAUDE_PROMPT_PROFILE` | 默认 `pentest`；改为 `default` 等可恢复更泛化的上游风格导语 |
| `OPENCLAUDE_VERBOSE_SYSPROMPT` | 设为 `1` 时附加长版 pentest 合同与 AES 示例（更费 token） |
| `OPENCLAUDE_VERBOSE_ENV_SYSPROMPT` | 设为 `1` 时在环境块中恢复型号说明、产品文案等 |
| `OPENCLAUDE_PENTEST_RAG_MAX_CHARS` | RAG 注入最大字符数（默认约 4500） |
| `OPENCLAUDE_RAG_IMPORT_ROOT` | `/rag-add` 允许导入的额外根目录（需配合路径校验） |
| `OPENCLAUDE_CONTEXT_RAG` | 非 pentest profile 时设为 `1` 可开启 RAG 注入 |
| `OPENCLAUDE_CONTEXT_RAG_DISABLED` | 设为真则关闭 RAG |

## 从源码运行

```bash
bun install
bun run build
node dist/cli.mjs
```

开发调试：

```bash
bun run dev
```

常用脚本仍与上游一致，例如 `bun test`、`bun run smoke`（详见 `package.json`）。

## 合规与边界

- 仅用于**你拥有或已书面授权**的系统与数据；禁止用于未授权测试或违法用途。
- 工具与模型可能产生错误，**漏洞结论与利用代码须由你方复核**后再用于生产或对外披露。

## 安全披露

见 [SECURITY.md](SECURITY.md)。

## 上游与许可

- 基于 OpenClaude / Claude Code 系代码 fork，**与 Anthropic 无隶属或背书关系**；「Claude」等为 Anthropic 商标。
- 许可证见 [LICENSE](LICENSE)。
- 参与贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。
