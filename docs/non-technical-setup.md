# Neural Network for Non-Technical Users

This guide is for people who want the easiest setup path.

You do not need to build from source. You do not need Bun. You do not need to understand the full codebase.

If you can copy and paste commands into a terminal, you can set this up.

## What Neural Network Does

Neural Network lets you use an AI coding assistant with different model providers such as:

- OpenAI
- DeepSeek
- Gemini
- Ollama
- Codex

For most first-time users, OpenAI is the easiest option.

## Before You Start

You need:

1. Node.js 20 or newer installed
2. A terminal window
3. An API key from your provider, unless you are using a local model like Ollama

## Fastest Path

1. Install Neural Network with npm
2. Set 3 environment variables
3. Run `openclaude`

## Choose Your Operating System

- Windows: [Windows Quick Start](quick-start-windows.md)
- macOS / Linux: [macOS / Linux Quick Start](quick-start-mac-linux.md)

## Which Provider Should You Choose?

### OpenAI

Choose this if:

- you want the easiest setup
- you already have an OpenAI API key

### Ollama

Choose this if:

- you want to run models locally
- you do not want to depend on a cloud API for testing

### Codex

Choose this if:

- you already use the Codex CLI
- you already have Codex or ChatGPT auth configured

## What Success Looks Like

After you run `openclaude`, the CLI should start and wait for your prompt.

At that point, you can ask it to:

- explain code
- edit files
- run commands
- review changes

## Common Problems

### `openclaude` command not found

Cause:

- npm installed the package, but your terminal has not refreshed yet

Fix:

1. Close the terminal
2. Open a new terminal
3. Run `openclaude` again

### Invalid API key

Cause:

- the key is wrong, expired, or copied incorrectly

Fix:

1. Get a fresh key from your provider
2. Paste it again carefully
3. Re-run `openclaude`

### Ollama not working

Cause:

- Ollama is not installed or not running

Fix:

1. Install Ollama from `https://ollama.com/download`
2. Start Ollama
3. Try again

## Want More Control?

If you want source builds, advanced provider profiles, diagnostics, or Bun-based workflows, use:

- [Advanced Setup](advanced-setup.md)
