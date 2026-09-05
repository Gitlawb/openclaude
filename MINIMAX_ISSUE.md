# OpenClaude × MiniMax 国内端点兼容性问题(技术报告)

> 状态:**待修复** — 不阻塞使用,但 profile 自动加载路径在 MiniMax 国内端点上完全坏掉。
> 报告版本:`openclaude@0.30.0`(commit `0ea8eefb`,2026-09-04)
> 本文档可作为上游 issue 的中文底稿,关键代码引用已用 `file_path:line` 标出。

---

## 1. 现象

### 1.1 复现步骤

在 macOS / Linux 上(无关安装方式,`npm install -g`、`bun install` 源码构建都触发):

1. 创建 `~/.openclaude/.openclaude-profile.json`:
   ```json
   {
     "profile": "openai",
     "env": {
       "CLAUDE_CODE_USE_OPENAI": "1",
       "OPENAI_BASE_URL": "https://api.minimaxi.com/v1",
       "OPENAI_MODEL": "MiniMax-M3",
       "OPENAI_API_KEY": "<key>",
       "MINIMAX_API_KEY": "<key>"
     },
     "createdAt": "2026-09-04T..."
   }
   ```
2. 直接执行(不 source env):
   ```bash
   node $(npm root -g)/@gitlawb/openclaude/dist/cli.mjs --print "你好"
   ```
3. **结果**:`Failed to authenticate. API Error: Authentication failed (status 401). Check your API key configuration.`(exit code 0)

### 1.2 对照(确认端点/key/模型名本身没问题)

| 验证方式 | 命令 | 结果 |
|---|---|---|
| 直连 curl(OpenAI 协议) | `curl -X POST https://api.minimaxi.com/v1/chat/completions -H "Authorization: Bearer <key>" -d '{"model":"MiniMax-M3",...}'` | 200 OK,`model: MiniMax-M3` |
| 直连 curl(Anthropic 协议) | `curl -X POST https://api.minimaxi.com/anthropic/v1/messages -H "x-api-key: <key>" -d '{"model":"MiniMax-M3",...}'` | 200 OK,`model: MiniMax-M3` |
| OpenClaude + env 直接启动 | `OPENAI_BASE_URL=... node dist/cli.mjs --print "..."` | 正常返回模型响应 |

→ 401 是 **OpenClaude 内部 routing 决策错误**,不是端点 / key / 模型名问题。

---

## 2. 根因分析(三层耦合)

### 2.1 第一层:`isMiniMaxBaseUrl()` 漏掉国内端点

**位置**:`src/integrations/routeMetadata.ts:265-277`

```ts
export function isMiniMaxBaseUrl(value: string | undefined): boolean {
  // ...
  return hostname === 'api.minimax.io' || hostname === 'api.minimax.chat'
}
```

只识别海外 `api.minimax.io` / `api.minimax.chat`,**漏掉** MiniMax 官方文档明确给出的国内端点 `api.minimaxi.com`(注意尾随的 `i`)。

下游影响:
- `getMiniMaxBaseUrlOverride()`(`routeMetadata.ts:707-726`)返回 `undefined`,`hasMiniMaxRouteIntent()` 的 baseUrl 分支为 false
- `resolveRouteIdFromBaseUrl()` 走到 host 匹配也匹配不到,`routeId` 降级为 `'custom'`

### 2.2 第二层:模型名触发 MiniMax 路由,但路由要求专属 key

**位置**:`src/integrations/routeMetadata.ts:728-734`

```ts
function isMiniMaxModelName(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return Boolean(
    normalized &&
      (normalized.startsWith('minimax-') || normalized.startsWith('minimax/')),
  )
}
```

`OPENAI_MODEL = 'MiniMax-M3'` → 包含小写 `minimax-` → `isMiniMaxModelName` = true → `hasMiniMaxRouteIntent` = true。

→ 路由解析时考虑 MiniMax vendor,但 MiniMax vendor 在 `requestExecutor.ts:341-352` 的 `apiKeyRaw` 选择链里:

```ts
// requestExecutor.ts:341-352
const apiKeyRaw =
  providerOverride?.apiKey ??
  (openAIApiKeyIsCopiedProviderKey &&
  routeAcceptsGenericOpenAICredentials
    ? openAIApiKeyRawUsable
    : undefined) ??
  // ...
  routeCredential ??  // MiniMax vendor 这里读 MINIMAX_API_KEY
  (routeAcceptsGenericOpenAICredentials
    ? openAIApiKeyRawUsable || xaiOAuthToken || ''  // generic 路径才用 OPENAI_API_KEY
    : '')
```

对 MiniMax 这个 native vendor,`routeAcceptsGenericOpenAICredentials` 为 `false`(见 `routeMetadata.ts:186` 注释:"True for native vendor routes (e.g. MiniMax, xAI)"),最终 fallback 不到 `OPENAI_API_KEY`,只能从 `MINIMAX_API_KEY` / `ANTHROPIC_API_KEY` 拿 key。

### 2.3 第三层:`buildLaunchEnv` 没有 MiniMax 分支,profile env 被吞掉

**位置**:`src/utils/providerProfile.ts:1553-2017`

`buildLaunchEnv` 共 11 个 `selectedProfile ===` 分支(`grep` 结果):
```
github / github-enterprise (1654)
anthropic                     (1679)
bedrock                       (1722)
vertex                        (1744)
gemini                        (1766)
mistral                       (1803)
xai                           (1847)
opencode                      (1919)
ollama                        (1950)
atomic-chat                   (1968)
codex                         (1987)
```
**没有 `selectedProfile === 'minimax'`。**

后果:
- 用户写 `profile: "minimax"` → 落到末尾的 generic OpenAI 分支(`providerProfile.ts:2019+`),只读 `OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_KEY` 等,**不读** `MINIMAX_API_KEY` / `ANTHROPIC_*`,反而把 `MINIMAX_API_KEY` 当成未知字段透传或被 `clearManagedProfileEnv` 清掉
- 用户写 `profile: "openai"` → 同样走 generic 分支,但模型名 `MiniMax-M3` 触发 `isMiniMaxModelName`,请求时 `routeAcceptsGenericOpenAICredentials` 为 false → 401

**两个写法都坏**,因为整个 `applyStartupEnvFromProfile` → `buildLaunchEnv` 链路对 MiniMax 的处理是缺失的。

`buildMiniMaxProfileEnv()`(`providerProfile.ts:479-519`)已经存在并能正确组装 `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` / `MINIMAX_API_KEY` / `ANTHROPIC_API_KEY`,但**没有任何路径调用它**。

---

## 3. 影响范围

| 维度 | 状态 |
|---|---|
| 端点 `api.minimax.io`(海外) | 正常工作(`isMiniMaxBaseUrl` 命中) |
| 端点 `api.minimaxi.com`(国内) | **失败** |
| 端点 `api.minimax.chat` | 正常工作 |
| 协议 OpenAI 兼容 | OpenClaude 支持通用,但 MiniMax vendor 不接受 generic key |
| 协议 Anthropic 兼容 | OpenClaude 支持通用,但 MiniMax vendor 默认走 Anthropic 协议 |
| 安装方式 | `npm install -g` / `bun install` 源码 / `bun run build` 都触发同样的代码路径,均失败 |
| `/provider` 交互流程 | preset 列表里只有"MiniMax API endpoint"(即海外),**没有国内端点选项**;手动改成 `api.minimaxi.com/v1` 仍撞 vendor routing 兼容问题 |
| 临时方案 | 用 env 变量启动(详见 `MINIMAX_SETUP.md` 第 3 节) |

### 3.1 关于 `/provider` preset 列表

`/provider` 命令的 preset 列表里"MiniMax API endpoint"是单一 vendor,描述来自 `src/integrations/vendors/minimax.ts:20`(`description: 'MiniMax API endpoint'`)。`ProviderManager.tsx:310-322` 的 `presetToDraft()` 把 vendor 默认值 `getRouteDefaultBaseUrl('minimax') = 'https://api.minimax.io/anthropic'` 填进 baseUrl,**没有给用户区分国内/海外的入口**。

要让国内端点工作,需要 UI 层增加一个"国内端点"分支(改 `presetToDraft()` 或加新 preset)。这是产品决策问题,不是单纯代码 bug。

---

## 4. 临时方案(workaround)

不需要改 OpenClaude 代码,用户侧可绕过:

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL='https://api.minimaxi.com/v1'
export OPENAI_MODEL='MiniMax-M3'
export OPENAI_API_KEY='<key>'
node $(npm root -g)/@gitlawb/openclaude/dist/cli.mjs
```

`CLAUDE_CODE_USE_OPENAI=1` 强制走 generic OpenAI shim,绕过 MiniMax native vendor 的 key 校验路径。

---

## 5. 建议的修复方案

最小可行修复(三处独立改动,可单独 cherry-pick):

### 5.1 补齐 `isMiniMaxBaseUrl` 的国内端点

**文件**:`src/integrations/routeMetadata.ts:273`

```diff
-    return hostname === 'api.minimax.io' || hostname === 'api.minimax.chat'
+    return (
+      hostname === 'api.minimax.io' ||
+      hostname === 'api.minimax.chat' ||
+      hostname === 'api.minimaxi.com'
+    )
```

参考依据:MiniMax 官方文档 [platform.minimaxi.com/docs/guides/text-generation](https://platform.minimaxi.com/docs/guides/text-generation),国内端点 `https://api.minimaxi.com/v1`(OpenAI)与 `https://api.minimaxi.com/anthropic`(Anthropic)同时存在。

### 5.2 在 `buildLaunchEnv` 增加 MiniMax 分支

**文件**:`src/utils/providerProfile.ts`,在 `if (selectedProfile === 'codex')` 分支(行 1987)之前或之后插入:

```ts
if (selectedProfile === 'minimax') {
  const persistedKey =
    sanitizeApiKey(persistedEnv.MINIMAX_API_KEY) ||
    sanitizeApiKey(persistedEnv.ANTHROPIC_API_KEY) ||
    sanitizeApiKey(persistedEnv.OPENAI_API_KEY)
  const shellKey =
    sanitizeApiKey(processEnv.MINIMAX_API_KEY) ||
    sanitizeApiKey(processEnv.ANTHROPIC_API_KEY) ||
    sanitizeApiKey(processEnv.OPENAI_API_KEY)
  const miniMaxEnv = buildMiniMaxProfileEnv({
    model: persistedEnv.ANTHROPIC_MODEL || persistedEnv.OPENAI_MODEL,
    baseUrl:
      persistedEnv.ANTHROPIC_BASE_URL ||
      persistedEnv.OPENAI_BASE_URL ||
      processEnv.ANTHROPIC_BASE_URL ||
      processEnv.OPENAI_BASE_URL,
    apiKey: shellKey || persistedKey,
    processEnv,
  })
  if (miniMaxEnv) {
    return buildCompatibilityProcessEnv({
      processEnv,
      compatibilityMode: 'anthropic',
      profileEnv: miniMaxEnv,
    })
  }
}
```

复用已有的 `buildMiniMaxProfileEnv()`(`providerProfile.ts:479-519`)。

### 5.3 在 `applyStartupEnvFromProfile` / `applyProfileEnvToProcessEnv` 中保留 `MINIMAX_API_KEY` 的镜像

**文件**:`src/utils/providerProfile.ts` 的 `clearManagedProfileEnv` 函数附近

当 profile 写的是 `OPENAI_API_KEY` 但 model 触发 `isMiniMaxModelName` 时,启动器应把 `OPENAI_API_KEY` 镜像为 `MINIMAX_API_KEY`,让 MiniMax vendor 路由能找到 key(否则如第 2.2 节所述,`apiKeyRaw` 落到空字符串 → 401)。

镜像逻辑可以在 `applyStartupEnvFromProfile` 返回前增加:

```ts
if (
  startupEnv.OPENAI_API_KEY &&
  !startupEnv.MINIMAX_API_KEY &&
  isMiniMaxModelName(startupEnv.OPENAI_MODEL)
) {
  startupEnv.MINIMAX_API_KEY = startupEnv.OPENAI_API_KEY
}
```

### 5.4 (可选)对齐 profile 字段命名

`ProfileEnv` 类型(`providerProfile.ts:161-221`)已经定义了 `MINIMAX_API_KEY` 字段,但 `buildOpenAIProfileEnv()`(`providerProfile.ts:911-1018`)不会自动镜像它。建议在 `buildOpenAIProfileEnv()` 末尾也加一段 `MINIMAX_API_KEY` 透传逻辑,以兼容 `profile: "openai"` 的写法。

---

## 6. 修复后的验证步骤

```bash
# 1. 重跑现有测试
bun test src/utils/providerProfile.test.ts
bun test src/services/api/openaiShim/requestExecutor.integration.test.ts

# 2. 手工回归
cat > ~/.openclaude/.openclaude-profile.json <<'JSON'
{
  "profile": "openai",
  "env": {
    "OPENAI_BASE_URL": "https://api.minimaxi.com/v1",
    "OPENAI_MODEL": "MiniMax-M3",
    "OPENAI_API_KEY": "<key>"
  },
  "createdAt": "2026-09-05T..."
}
JSON
node dist/cli.mjs --print "你好,介绍下你自己,报上模型名"
# 期望:返回模型响应,无 401
```

```bash
# 3. 端点扫描测试:新增国内端点应被识别为 MiniMax vendor
bun test src/integrations/routeMetadata.test.ts
```

---

## 7. 相关代码索引

| 关注点 | 位置 |
|---|---|
| `isMiniMaxBaseUrl` | `src/integrations/routeMetadata.ts:265-277` |
| `isMiniMaxModelName` | `src/integrations/routeMetadata.ts:728-734` |
| `hasMiniMaxRouteIntent` | `src/integrations/routeMetadata.ts:736-742` |
| `buildMiniMaxProfileEnv`(已存在但未挂载) | `src/utils/providerProfile.ts:479-519` |
| `buildOpenAIProfileEnv`(不镜像 MINIMAX_API_KEY) | `src/utils/providerProfile.ts:911-1018` |
| `buildLaunchEnv`(无 MiniMax 分支) | `src/utils/providerProfile.ts:1553-2017` |
| `applyStartupEnvFromProfile` | `src/utils/providerProfile.ts:2496-2540` |
| `apiKeyRaw` 选择链 | `src/services/api/openaiShim/requestExecutor.ts:341-352` |
| MiniMax vendor 入口 | `src/integrations/vendors/minimax.ts:7`(`defaultBaseUrl: 'https://api.minimax.io/anthropic'`) |

---

## 8. 备注

- 本文档不替代 `MINIMAX_SETUP.md`(那份是用户接入手册);这里是技术根因 + 修复路径
- 配套文档:`MINIMAX_SETUP.md` 第 4 节会精简,指向本文档
- 上游 issue 模板可直接基于本文档第 1、2、5 节构造