# OpenClaude × MiniMax-M3 接入说明

适用于 openclaude ≥ 0.31.0（已包含 `minimax` / `minimax-cn` native preset）。

本仓库针对 MiniMax 平台（`MiniMax-M3`，1M context）完成连通性验证，覆盖海外（`api.minimax.io`）和国内（`api.minimaxi.com`）两个 endpoint。两种端点都通过 native vendor preset 接入，无需 OpenAI 通用 shim 绕过。

---

## 1. 选 preset

| 区域 | preset | 默认 endpoint |
|---|---|---|
| 海外 | `minimax` | `https://api.minimax.io/anthropic` |
| 国内 | `minimax-cn` | `https://api.minimaxi.com/anthropic` |

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

---

## 4. 端点选择规则

优先级（高 → 低）：

1. **shell 显式 export**：`ANTHROPIC_BASE_URL`、`OPENAI_BASE_URL` 等
2. **持久化 profile**：上次 `openclaude --provider minimax-cn` 写入 `~/.openclaude/` 的值
3. **preset 默认**：见第 1 节表格

如果传入的 base URL 是 OpenAI 风格 `…/v1` 形式（遗留配置），系统会自动翻译为 `…/anthropic/v1`，无需手动调整。

---

## 5. 排错 Checklist

按顺序检查：

- [ ] `echo "$MINIMAX_API_KEY"` 输出非空
- [ ] preset 与 key 区域匹配（CN key → `minimax-cn`；海外 key → `minimax`）
- [ ] `openclaude --provider minimax-cn --print "hi"` 返回有效响应（含 `MiniMax-M3`）
- [ ] 401/403 → key 错误或区域错配
- [ ] `…/v1/messages` 404 → 通常是 legacy OpenAI 风格 URL 没被翻译；显式 export `ANTHROPIC_BASE_URL` 即可
- [ ] 直连 curl 验证端点：
  ```bash
  curl -sS https://api.minimaxi.com/anthropic/v1/messages \
    -H "x-api-key: $MINIMAX_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "Content-Type: application/json" \
    -d '{"model":"MiniMax-M3","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}'
  ```
  期望返回 `200 OK` 与 `model: MiniMax-M3`。

---

## 6. 安全提醒

- `~/.openclaude/settings.json` 与 shell rc 文件都含 API key，**不要**复制到仓库内或提交到 git。
- 仓库 `.gitignore` 已包含 `.openclaude/`。
- 文件权限保持 `0o600`（仅当前用户可读写）。
- 旋转 key 时同步更新 `~/.openclaude/settings.json`，并删除 `~/.openclaude/.openclaude-profile.json` 中的旧值。
- 不要把 key 贴到 issue、PR、聊天记录或截图里。

---

## 7. 相关路径速查

| 用途 | 路径 |
|---|---|
| 项目根 | 当前 clone 的 openclaude 仓库目录 |
| CLI 入口 | `dist/cli.mjs`（构建产物） |
| SDK 入口 | `dist/sdk.mjs` |
| 用户配置 | `~/.openclaude/` |
| 持久化 profile | `~/.openclaude/.openclaude-profile.json` |
| 用户 settings | `~/.openclaude/settings.json` |
