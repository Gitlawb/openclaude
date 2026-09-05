# OpenClaude × MiniMax-M3 接入说明

本仓库已针对国内 MiniMax 平台（`api.minimaxi.com`、`MiniMax-M3`）完成连通性验证。
本文档记录当前可用的接入方式、配置文件位置、已知限制与排错步骤。

> 适用版本：`openclaude@0.30.0`（`/Users/mac/work/opensource/openclaude`）

---

## 1. 当前配置概要

| 项目 | 值 |
|---|---|
| Provider | MiniMax（`sk-cp-` 系列 API key） |
| Base URL（OpenAI 兼容） | `https://api.minimaxi.com/v1` |
| Base URL（Anthropic 兼容） | `https://api.minimaxi.com/anthropic` |
| 模型 | `MiniMax-M3`（上下文 1M tokens，带 thinking 模式） |
| Auth header | `Authorization: Bearer <key>`（OpenAI 协议）/ `x-api-key: <key>`（Anthropic 协议） |
| 推荐协议 | OpenAI 兼容（与 OpenClaude 通用 shim 对齐） |

注：MiniMax 在 OpenClaude 内是 **native vendor**，默认走 Anthropic 兼容协议，且 `isMiniMaxBaseUrl()` 只识别 `api.minimax.io` / `api.minimax.chat`，**不**识别 `api.minimaxi.com`。本文档的接入方式显式走 OpenAI 通用 shim，绕开 native vendor 路由匹配。

---

## 2. 已落地的配置文件

两个文件都位于 `~/.openclaude/`，权限 `0o600`，已被 `.gitignore` 排除（`.openclaude-profile.json` 与 `.openclaude/`）：

### 2.1 `~/.openclaude/openclaude-minimax.env`（**推荐使用**）

shell 启动 wrapper，`source` 后再启动 CLI 即可。

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL='https://api.minimaxi.com/v1'
export OPENAI_MODEL='MiniMax-M3'
export OPENAI_API_KEY='<your-key-here>'
```

### 2.2 `~/.openclaude/.openclaude-profile.json`（**当前未生效**）

结构：

```json
{
  "profile": "openai",
  "env": {
    "CLAUDE_CODE_USE_OPENAI": "1",
    "OPENAI_BASE_URL": "https://api.minimaxi.com/v1",
    "OPENAI_MODEL": "MiniMax-M3",
    "OPENAI_API_KEY": "...",
    "MINIMAX_API_KEY": "..."
  },
  "createdAt": "2026-09-04T..."
}
```

包含 OPENAI / MINIMAX 两套 key 与 `CLAUDE_CODE_USE_OPENAI=1`，理论上能覆盖所有已知路由分支，但**实际启动仍 401**——见第 4 节。

---

## 3. 启动方式（任选其一）

### 3.1 推荐：先 `source` 再启动

```bash
source ~/.openclaude/openclaude-minimax.env
cd /Users/mac/work/opensource/openclaude
node dist/cli.mjs                  # 交互式 TUI（需要真终端）
node dist/cli.mjs --print "你好"   # 非交互一次调用
```

### 3.2 等价的 inline 写法

```bash
cd /Users/mac/work/opensource/openclaude
CLAUDE_CODE_USE_OPENAI=1 \
OPENAI_BASE_URL=https://api.minimaxi.com/v1 \
OPENAI_MODEL=MiniMax-M3 \
OPENAI_API_KEY=<your-key> \
node dist/cli.mjs
```

### 3.3 永久化（可选）

把 `source ~/.openclaude/openclaude-minimax.env` 追加到 `~/.zshrc`（或 `~/.bashrc`），新 shell 默认即持有 env。**注意**：env 文件含明文 key，请确保本机用户目录权限安全。

### 3.4 验证连通性

```bash
source ~/.openclaude/openclaude-minimax.env
node /Users/mac/work/opensource/openclaude/dist/cli.mjs --print "用一句话介绍你自己,报上模型名"
```

期望输出含 `MiniMax-M3` 字样与有效响应。

---

## 4. 已知问题：profile 自动加载路径

### 现象

直接执行 `node dist/cli.mjs --print "..."`（不 source wrapper、不 inline env）→ **401 Authentication failed**。

### 简述

OpenClaude 处理 MiniMax 国内端点（`api.minimaxi.com`）与 `MiniMax-M3` 模型名的组合时，profile 自动加载路径坏掉。三层耦合：`isMiniMaxBaseUrl()` 漏掉 `api.minimaxi.com`；模型名触发 native vendor 路由但 vendor 不接受 generic key；`buildLaunchEnv` 缺 `minimax` 分支。

### 临时方案

显式 `source` wrapper 或 inline 设置 env（见第 3 节），绕开 profile 自动加载。

### 详细根因 + 修复建议

见 [`MINIMAX_ISSUE.md`](./MINIMAX_ISSUE.md)，包含完整复现步骤、代码引用、建议 patch、验证脚本。适合作为 upstream issue 的中文底稿。

---

## 5. 排错 Checklist

按顺序检查：

- [ ] `source ~/.openclaude/openclaude-minimax.env` 后 `echo "$OPENAI_BASE_URL"` 输出 `https://api.minimaxi.com/v1`
- [ ] `echo "${#OPENAI_API_KEY}"` 输出 125（key 长度，未 source 则为 0）
- [ ] `node dist/cli.mjs --print "hi"` 直接跑仍 401 → 属于已知问题，必须 source wrapper
- [ ] `node dist/cli.mjs --print` 报 `ERR_MODULE_NOT_FOUND '@orama/orama'` → 见第 6 节修复模块解析
- [ ] 直连 curl 验证端点：
  ```bash
  curl -sS https://api.minimaxi.com/v1/chat/completions \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"hi"}],"max_tokens":16}'
  ```
  期望返回 `200 OK` 与 `model: MiniMax-M3`。

---

## 6. 模块解析修复（一次性）

仅当 `node dist/cli.mjs` 报 `ERR_MODULE_NOT_FOUND '@orama/orama'` 时执行：

```bash
mkdir -p ~/.openclaude/node_modules/@orama 2>/dev/null
ln -sfn "$PWD/node_modules/.pnpm/@orama+orama@3.1.18/node_modules/@orama/orama" \
  "$PWD/node_modules/@orama/orama"
ln -sfn "$PWD/node_modules/.pnpm/@orama+plugin-data-persistence@3.1.18/node_modules/@orama/plugin-data-persistence" \
  "$PWD/node_modules/@orama/plugin-data-persistence"
```

原理：`bun install` 默认 hoisted 策略下，`@orama/orama` 与 `@orama/plugin-data-persistence` 被放在 `.pnpm/.../`，未在 `node_modules/@orama/` 顶层建子目录。Node 直接跑 `dist/cli.mjs` 解析不到。绝对路径 symlink 兜底解决。后续 `bun install` 重跑会清掉这两个 symlink，需要重新建。`node_modules/` 在 `.gitignore` 中，这些 symlink 不会进入 git。

---

## 7. 安全提醒

- `~/.openclaude/.openclaude-profile.json` 与 `~/.openclaude/openclaude-minimax.env` 都含 API key，**不要**复制到仓库内或提交到 git。仓库 `.gitignore` 已包含 `.openclaude-profile.json` 与 `.openclaude/`，但 `openclaude-minimax.env` 位于 `~/.openclaude/`，处于 git 跟踪之外。
- 这两个文件权限保持 `0o600`（仅当前用户可读写）。
- 旋转 key 时同步更新 wrapper 文件并删除 `~/.openclaude/.openclaude-profile.json`。
- 不要把 key 贴到 issue、PR、聊天记录或截图里。

---

## 8. 相关路径速查

| 用途 | 路径 |
|---|---|
| 项目根 | `/Users/mac/work/opensource/openclaude` |
| CLI 入口 | `dist/cli.mjs` |
| SDK 入口 | `dist/sdk.mjs` |
| 配置目录 | `~/.openclaude/` |
| Profile | `~/.openclaude/.openclaude-profile.json` |
| Wrapper | `~/.openclaude/openclaude-minimax.env` |
| 启动文档 | `README.md` |