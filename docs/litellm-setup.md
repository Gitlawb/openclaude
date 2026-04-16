# LiteLLM Setup

Neural Network can connect to LiteLLM through LiteLLM's OpenAI-compatible proxy.

## Overview

LiteLLM is an open-source LLM gateway that provides a unified API to 100+ model providers. By running the LiteLLM Proxy, you can route Neural Network requests through LiteLLM to access any of its supported providers — all while using Neural Network's existing OpenAI-compatible provider path.

## Prerequisites

- LiteLLM installed (`pip install litellm[proxy]`)
- A `litellm_config.yaml` or equivalent LiteLLM configuration
- LiteLLM Proxy running on a local or remote port

## 1. Start the LiteLLM Proxy

### Basic installation

```bash
pip install litellm[proxy]
```

### Configure LiteLLM

Create a `litellm_config.yaml` with your desired model aliases:

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

  - model_name: claude-sonnet-4
    litellm_params:
      model: anthropic/claude-sonnet-4-5-20250929
      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: gemini-2.5-flash
    litellm_params:
      model: gemini/gemini-2.5-flash
      api_key: os.environ/GEMINI_API_KEY

  - model_name: llama-3.3-70b
    litellm_params:
      model: together_ai/meta-llama/Llama-3.3-70B-Instruct-Turbo
      api_key: os.environ/TOGETHER_API_KEY
```

### Run the proxy

```bash
litellm --config litellm_config.yaml --port 4000
```

The proxy will start at `http://localhost:4000` by default.

## 2. Point Neural Network to LiteLLM

### Option A: Environment Variables

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL=http://localhost:4000
export OPENAI_API_KEY=<your-master-key-or-placeholder>
export OPENAI_MODEL=<your-litellm-model-alias>
openclaude
```

Replace `<your-litellm-model-alias>` with a model name from your `litellm_config.yaml` (e.g., `gpt-4o`, `claude-sonnet-4`, `gemini-2.5-flash`).

### Option B: Using /provider

1. Run `openclaude`
2. Type `/provider` to open the provider setup flow
3. Choose the **OpenAI-compatible** option
4. When prompted for the API key, enter the key required by your LiteLLM proxy
   If your local LiteLLM setup does not enforce auth, you may still need to enter a placeholder value
      - 5. When prompted for the base URL, enter `http://localhost:4000`
        6. 6. When prompted for the model, enter the LiteLLM model name or alias you configured
           7. 7. Save the provider configuration

## 3. Example LiteLLM Configs

### Multi-provider routing with spend tracking

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

  - model_name: claude-sonnet-4
    litellm_params:
      model: anthropic/claude-sonnet-4-5-20250929
      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: deepseek-chat
    litellm_params:
      model: deepseek/deepseek-chat
      api_key: os.environ/DEEPSEEK_API_KEY

litellm_settings:
  set_verbose: false
  num_retries: 3
```

### With a master key for auth

```bash
# Start proxy with a master key
litellm --config litellm_config.yaml --port 4000 --master_key sk-my-master-key

# Connect Neural Network
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL=http://localhost:4000
export OPENAI_API_KEY=sk-my-master-key
export OPENAI_MODEL=gpt-4o
openclaude
```

## 4. Notes

- `OPENAI_MODEL` must match the **LiteLLM model alias** defined in your config, not the upstream raw provider model name.
- If your proxy requires authentication, use the proxy key (or `master_key`) in `OPENAI_API_KEY`.
- LiteLLM's OpenAI-compatible endpoint accepts the same request format as OpenAI, so Neural Network works without any code changes.
- You can switch between any provider configured in LiteLLM by simply changing the `OPENAI_MODEL` value — no need to reconfigure Neural Network.

## 5. Troubleshooting

| Issue | Likely Cause | Fix |
|-------|--------------|-----|
| 404 or Model Not Found | Model alias doesn't exist in LiteLLM config | Verify the `model_name` in `litellm_config.yaml` matches `OPENAI_MODEL` |
| Connection Refused | LiteLLM proxy isn't running | Start the proxy with `litellm --config litellm_config.yaml --port 4000` |
| Auth Failed | Missing or wrong `master_key` | Set the correct key in `OPENAI_API_KEY` |
| Upstream provider error | The backend provider key is missing or invalid | Ensure the upstream API key (e.g., `OPENAI_API_KEY`) is set in your LiteLLM proxy process environment |
| Tools fail but chat works | The selected model has weak function/tool calling support | Switch to a model with strong tool support (e.g., GPT-4o, Claude Sonnet) |

## 6. Resources

- [LiteLLM Proxy Docs](https://docs.litellm.ai/docs/proxy/quick_start)
- [LiteLLM Provider List](https://docs.litellm.ai/docs/providers)
- [LiteLLM OpenAI-Compatible Endpoints](https://docs.litellm.ai/docs/proxy/openai_compatible_proxy)
