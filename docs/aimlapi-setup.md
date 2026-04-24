# AI/ML API Setup

OpenClaude can run through AI/ML API as a first-class OpenAI-compatible provider. AI/ML API exposes `https://api.aimlapi.com/v1` and OpenClaude sends chat requests to `https://api.aimlapi.com/v1/chat/completions`.

## Setup with `/provider`

1. Start OpenClaude.
2. Run `/provider`.
3. Choose `AI/ML API`.
4. Paste your AI/ML API key.
5. Keep the default model `gpt-4o` or enter another chat-capable model ID.

## Setup with environment variables

macOS / Linux:

```bash
export CLAUDE_CODE_USE_OPENAI=1
export AIMLAPI_API_KEY=your-aimlapi-key-here
export OPENAI_BASE_URL=https://api.aimlapi.com/v1
export OPENAI_MODEL=gpt-4o
```

Windows PowerShell:

```powershell
$env:CLAUDE_CODE_USE_OPENAI="1"
$env:AIMLAPI_API_KEY="your-aimlapi-key-here"
$env:OPENAI_BASE_URL="https://api.aimlapi.com/v1"
$env:OPENAI_MODEL="gpt-4o"
```

OpenClaude uses chat/tool-capable models for coding-agent workflows. AI/ML API also offers other modalities such as image, video, voice, music, embeddings, OCR, and 3D generation; those models are available through AI/ML API but are outside OpenClaude's core chat/tool loop.

Browse models at [aimlapi.com/models](https://aimlapi.com/models) and read provider docs at [docs.aimlapi.com](https://docs.aimlapi.com/).
