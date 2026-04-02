# NVIDIA NVCF 提供商配置指南

## 🚀 30 秒快速开始

```bash
# 1. 设置环境变量
export CLAUDE_CODE_USE_NVIDIA=1
export NVIDIA_API_KEY=nvapi-your-key-here
export NVIDIA_MODEL=meta/llama3-70b-instruct

# 2. 运行
openclaude
```

**提示**: 更多测试工具请查看 [test/README.md](../test/README.md)

## 概述

OpenClaude 现已支持 NVIDIA NVCF (NVIDIA Cloud Functions) API，这是一个 OpenAI 兼容的推理服务。

## 支持的模型

NVIDIA NVCF 提供多种模型，包括：
- **Meta Llama 3** 系列 (8B, 70B)
- **Nemotron** 系列
- 以及其他通过 NVIDIA NIM 部署的模型

完整模型列表请访问：https://build.nvidia.com/

## 获取 API Key

1. 访问 [NVIDIA Build](https://build.nvidia.com/)
2. 注册或登录您的 NVIDIA 账户
3. 在 API 页面生成您的 API Key

## 配置方法

### 方法一：使用环境变量（推荐）

```bash
# 启用 NVIDIA 提供商
export CLAUDE_CODE_USE_NVIDIA=1

# 设置 API Key
export NVIDIA_API_KEY=nvapi-xxxxxxxxxxxxx

# 可选：自定义模型（默认：meta/llama3-70b-instruct）
export NVIDIA_MODEL=meta/llama3-70b-instruct

# 可选：自定义端点 URL
export NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
```

**提示**: 将上述命令添加到你的 `~/.bashrc` 或 `~/.zshrc` 文件中，以便永久生效。模型
```

### 方法二：使用配置文件

```bash
bun run build:profile --provider nvidia --api-key nvapi-xxxxxxxxxxxxx --model meta/llama3-70b-instruct
```

### 方法三：命令行参数

```bash
openclaude --provider nvidia --api-key nvapi-xxxxxxxxxxxxx --model meta/llama3-70b-instruct
```

## 可用模型示例

```bash
# Meta Llama 3 70B Instruct（推荐）
export NVIDIA_MODEL=meta/llama3-70b-instruct

# Meta Llama 3 8B Instruct（快速、经济）
export NVIDIA_MODEL=meta/llama3-8b-instruct

# MiniMax M2.5
export NVIDIA_MODEL=minimax/minimax-m2.5

# Meta Llama 3 70B Instruct（高性能）
export NVIDIA_MODEL=meta/llama3-70b-instruct

# Nemotron-4 340B Instruct
export NVIDIA_MODEL=nvidia/nemotron-4-340b-instruct

# Mistral AI 模型
export NVIDIA_MODEL=mistralai/mistral-large-2407
```

**热门模型对比**:

| 模型 | 用途 | 速度 | 成本 |
|------|------|------|------|
| `meta/llama3-8b-instruct` | 简单任务 | ⚡⚡⚡ | 💰 |
| `meta/llama3-70b-instruct` | 通用推荐 | ⚡⚡ | 💰💰 |
| `minimaxai/minimax-m2.5` | 复杂推理 | ⚡⚡ | 💰💰 |
| `nvidia/nemotron-4-340b-instruct` | 专业场景 | ⚡ | 💰💰💰 |

**注意**: MiniMax 模型的正确 ID 是 `minimaxai/minimax-m2.5`（不是 `minimax/minimax-m2.5`）。使用 `bun run test:list-models minimax` 查找正确的模型名称。

## 智能路由模式

如果您启用了智能路由模式（ROUTER_MODE=smart），NVIDIA 提供商将自动参与路由决策：

```bash
ROUTER_MODE=smart
ROUTER_STRATEGY=balanced  # 或 latency、cost
ROUTER_FALLBACK=true
```

智能路由器会根据以下因素自动选择最佳提供商：
- **延迟** - 实时 ping 测试
- **成本** - NVIDIA 通常比 OpenAI 更便宜
- **健康状态** - 自动故障转移

## 性能优化建议

1. **低延迟场景**：使用 `ROUTER_STRATEGY=latency`
2. **成本敏感场景**：使用 `ROUTER_STRATEGY=cost`
3. **平衡模式**：使用 `ROUTER_STRATEGY=balanced`（默认）

## 🎯 使用场景推荐

### ✅ 适合
- 成本敏感的生产环境
- 需要 OpenAI 兼容 API
- 大规模批量推理
- 企业级 SLA 需求
- 多模型切换场景

### ❌ 不适合
- 完全离线环境（考虑 Ollama）
- 需要特定闭源模型（如 Claude）
- 超低延迟要求（考虑本地部署）

## 🛠️ 故障排除速查

| 问题 | 解决方案 |
|------|----------|
| 401 错误 | 检查 API Key 是否正确，确保以 `nvapi-` 开头 |
| 模型不可用 | 确认模型名称，访问 build.nvidia.com 查看可用模型 |
| 响应慢 | 换用小模型或检查网络连接 |
| 找不到命令 | 确认已安装 `npm install -g @gitlawb/openclaude` |
| 连接超时 | 检查网络是否能访问 integrate.api.nvidia.com |

## 📊 与其他提供商对比

```
成本：NVIDIA < Gemini < OpenAI
延迟：Ollama(本地) < OpenAI < NVIDIA < Gemini
质量：OpenAI ≥ NVIDIA > Gemini > Ollama
隐私：Ollama(本地) > NVIDIA > OpenAI > Gemini
```

### Q: NVIDIA API Key 从哪里获取？
A: 访问 https://build.nvidia.com/ 并登录后在 API 管理页面生成。

### Q: 支持流式输出吗？
A: 是的，完全支持 SSE 流式输出。

### Q: 支持工具调用（Function Calling）吗？
A: 支持！NVIDIA NVCF API 兼容 OpenAI 的工具调用格式。

### Q: 如何切换回 OpenAI？
A: 设置 `CLAUDE_CODE_USE_OPENAI=1` 或删除 NVIDIA 相关环境变量。

### Q: 成本如何？
A: NVIDIA NVCF 的定价因模型而异，通常比 OpenAI 便宜。例如：
   - Llama 3 8B: ~$0.0001 / 1K tokens
   - Llama 3 70B: ~$0.0004 / 1K tokens

详细定价请查看 NVIDIA 官方文档。

## 与其他提供商对比

| 特性 | NVIDIA | OpenAI | Ollama |
|------|--------|--------|--------|
| 成本 | 低 | 中 | 免费（本地） |
| 延迟 | 中 | 低 | 最低（本地） |
| 模型质量 | 高 | 最高 | 取决于模型 |
| 隐私 | 云端 | 云端 | 本地 |
| 需要 API Key | ✓ | ✓ | ✗ |

## 技术细节

### API 端点

- **基础 URL**: `https://integrate.api.nvidia.com/v1`
- **聊天补全**: `/v1/chat/completions`
- **模型列表**: `/v1/models`

### 认证方式

```http
Authorization: Bearer nvapi-xxxxxxxxxxxxx
```

### 请求示例

```bash
curl -X POST https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Authorization: Bearer nvapi-xxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta/llama3-70b-instruct",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

## 参考资料

- [NVIDIA NVCF 文档](https://docs.nvidia.com/cloud-functions/)
- [NVIDIA Build 平台](https://build.nvidia.com/)
- [OpenAI 兼容 API 参考](https://docs.nvidia.com/cloud-functions/current/latest/api.html)
