# OpenClaude × MiniMax 接入说明

适用于 openclaude ≥ 0.31.0（已包含 `minimax` / `minimax-cn` native preset）。

本仓库针对 MiniMax 平台完成连通性验证，覆盖海外（`api.minimax.io`）和国内（`api.minimaxi.com`）两个 endpoint。两种端点都通过 native vendor preset 接入，无需 OpenAI 通用 shim 绕过。

> 历史背景：本仓库之前兼容 MiniMax 端点时依赖 OpenAI shim；现已迁回 native Anthropic-compatible 路径。历史问题记录参见 [MINIMAX_ISSUE.md](./MINIMAX_ISSUE.md)。

---

## 1. 选 preset

| 区域 | preset | 默认 endpoint | 启动框标签 |
| --- | --- | --- | --- |
| 海外 | `minimax` | `https://api.minimax.io/anthropic` | `MiniMax` |
| 国内 | `minimax-cn` | `https://api.minimaxi.com/anthropic` | `MiniMax (China)` |

`minimax-cn` 与 `minimax` 共用同一个 `MINIMAX_API_KEY` env 变量；区域由 `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` 决定。CN key 与海外 key **不可互换**——选错 preset 会直接拿到 401/403。

---

## 2. 配置 API key

把 key 写到 `~/.openclaude/settings.json` 的 `env` 字段，或直接 export：

```bash
export MINIMAX_API_KEY='<your-key-here>'
```

> 注：MiniMax 的 API key 形如 `eyJ...`（JWT）或厂商自定义前缀。设置前请确认 key 与所选 preset 区域匹配（CN key 用于 `minimax-cn`，海外 key 用于 `minimax`）。

### settings.json 写法

```json
{
  "env": {
    "MINIMAX_API_KEY": "<your-key-here>"
  }
}
```

文件权限保持 `0o600`，且 `~/.openclaude/` 已被仓库 `.gitignore` 排除（不会进入 git）。

---

## 3. 启动

```bash
# 海外
openclaude --provider minimax --model MiniMax-M3

# 国内
openclaude --provider minimax-cn --model MiniMax-M3
```

非交互一次性调用：

```bash
openclaude --provider minimax-cn --model MiniMax-M3 --print "用一句话介绍你自己,报上模型名"
```

期望输出含 `MiniMax-M3` 字样。

> 安装版用户直接执行 `openclaude`；源码版从仓库根目录用 `<repo-root>` 占位执行：
>
> ```bash
> node <repo-root>/dist/cli.mjs --provider minimax-cn --model MiniMax-M3 --print "hi"
> ```
>
> `<repo-root>` 替换为你 clone 的 openclaude 仓库目录，不要把当前维护者的本地路径抄进命令。

---

## 4. 端点选择规则

优先级（高 → 低）：

1. **shell 显式 export 的 `ANTHROPIC_BASE_URL`**：始终胜出；只要是非空、非 sentinel（`null` / `undefined`）、非 MiniMax 已知默认值，就保留。
2. **shell 显式 export 的 `OPENAI_BASE_URL`** / `OPENAI_API_BASE`：作为备用 hint，会通过 `isMiniMaxBaseUrl` 判断区域。
3. **持久化 profile**：上次 `openclaude --provider minimax-cn` 写入 `~/.openclaude/` 的值。
4. **preset 默认**：见第 1 节表格。

如果传入的 base URL 是 OpenAI 风格 `…/v1` 形式（遗留配置），系统会自动翻译为 `…/v1/anthropic`，让 Anthropic SDK 的 `/v1/messages` 落地到正确子路径。

---

## 5. Legacy OpenAI-shim path（仅作为 fallback）

如果你的环境历史遗留只能走 OpenAI shim 而非 native preset（例如裸 CLI 无 `--provider`），可以继续用：

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL='https://api.minimaxi.com/v1'   # 或 https://api.minimax.io/v1
export OPENAI_MODEL='MiniMax-M3'
export MINIMAX_API_KEY='<your-key-here>'
openclaude --print "hi"
```

行为说明：

- **chat / completion 请求**走 OpenAI shim，endpoint 由 `OPENAI_BASE_URL` 决定。
- **`/usage` quota 请求**只接受 `MINIMAX_API_KEY`，**不接受 `OPENAI_API_KEY`**。这是为了防止把 OpenAI 主站的 key 误发给 MiniMax 的配额端点。如果只设了 `OPENAI_API_KEY`，`/usage` 会报 `MiniMax auth is required. Set MINIMAX_API_KEY.`
- 启动框的 "MiniMax (China)" 标签依赖 `api.minimaxi.com` host 识别；OpenAI 路径在 CN host 下也会显示 "MiniMax (China)"。

> 推荐：迁移到 `openclaude --provider minimax[-cn]` 后，legacy 配置可删除。

---

## 6. 排错 Checklist

按顺序检查：

- [ ] `[ -n "${MINIMAX_API_KEY:-}" ] && echo "MINIMAX_API_KEY is set"` 输出 `MINIMAX_API_KEY is set`（**不要**直接 `echo "$MINIMAX_API_KEY"`，那会把 key 打到终端 / 截图 / 日志）
- [ ] preset 与 key 区域匹配（CN key → `minimax-cn`；海外 key → `minimax`）
- [ ] `openclaude --provider minimax-cn --print "hi"` 返回有效响应（含 `MiniMax-M3`）
- [ ] 401/403 → key 错误或区域错配
- [ ] `…/v1/messages` 404 → 通常是 legacy OpenAI 风格 URL 没被翻译；显式 export `ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic` 或显式 `--provider minimax-cn` 即可
- [ ] 直连 curl 验证端点（**CN**）：

  ```bash
  curl -sS https://api.minimaxi.com/anthropic/v1/messages \
    -H "x-api-key: $MINIMAX_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "Content-Type: application/json" \
    -d '{"model":"MiniMax-M3","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}'
  ```

- [ ] 直连 curl 验证端点（**海外**）：

  ```bash
  curl -sS https://api.minimax.io/anthropic/v1/messages \
    -H "x-api-key: $MINIMAX_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "Content-Type: application/json" \
    -d '{"model":"MiniMax-M3","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}'
  ```

  期望返回 `200 OK` 与 `model: MiniMax-M3`。

> shell export 检查要用 `[ -n "${VAR:-}" ]` 这种参数展开形式，不要断言固定字符数（key 长度会变）。

---

## 7. 安全提醒

- `~/.openclaude/settings.json` 与 shell rc 文件都含 API key，**不要**复制到仓库内或提交到 git。
- 仓库 `.gitignore` 已包含 `.openclaude/`。
- 文件权限保持 `0o600`（仅当前用户可读写）。
- 旋转 key 时同步更新 `~/.openclaude/settings.json`，并删除 `~/.openclaude/.openclaude-profile.json` 中的旧值。
- 不要把 key 贴到 issue、PR、聊天记录或截图里；验证时用 `[ -n "${MINIMAX_API_KEY:-}" ] && echo set` 而不是直接 `echo "$MINIMAX_API_KEY"`。

---

## 8. 相关路径速查

| 用途 | 路径 |
| --- | --- |
| 项目根 | `<repo-root>`（当前 clone 的 openclaude 仓库目录） |
| CLI 入口 | `<repo-root>/dist/cli.mjs`（构建产物） |
| SDK 入口 | `<repo-root>/dist/sdk.mjs` |
| 用户配置 | `~/.openclaude/` |
| 持久化 profile | `~/.openclaude/.openclaude-profile.json` |
| 用户 settings | `~/.openclaude/settings.json` |
| 历史问题 | [MINIMAX_ISSUE.md](./MINIMAX_ISSUE.md) |
