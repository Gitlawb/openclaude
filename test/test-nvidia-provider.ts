#!/usr/bin/env bun run
/**
 * test-nvidia-provider.ts
 * TypeScript version of the NVIDIA provider test script
 */

console.log('======================================')
console.log('NVIDIA Provider Configuration Test')
console.log('======================================')
console.log()

// Check environment variables
console.log('Checking environment variables...')
console.log()

if (process.env.CLAUDE_CODE_USE_NVIDIA) {
  console.log(`✓ CLAUDE_CODE_USE_NVIDIA is set: ${process.env.CLAUDE_CODE_USE_NVIDIA}`)
} else {
  console.log('✗ CLAUDE_CODE_USE_NVIDIA is not set')
}

if (process.env.NVIDIA_API_KEY) {
  // Only show prefix to protect the key
  const keyPrefix = process.env.NVIDIA_API_KEY.slice(0, 10)
  console.log(`✓ NVIDIA_API_KEY is set: ${keyPrefix}...`)
} else {
  console.log('✗ NVIDIA_API_KEY is not set')
}

if (process.env.NVIDIA_MODEL) {
  console.log(`✓ NVIDIA_MODEL is set: ${process.env.NVIDIA_MODEL}`)
} else {
  console.log('ℹ NVIDIA_MODEL is not set (will use default)')
}

if (process.env.NVIDIA_BASE_URL) {
  console.log(`✓ NVIDIA_BASE_URL is set: ${process.env.NVIDIA_BASE_URL}`)
} else {
  console.log('ℹ NVIDIA_BASE_URL is not set (will use default)')
}

console.log()
console.log('======================================')
console.log('Quick Start Commands:')
console.log('======================================')
console.log()
console.log('# 1. Using environment variables:')
console.log('export CLAUDE_CODE_USE_NVIDIA=1')
console.log('export NVIDIA_API_KEY=nvapi-your-key-here')
console.log('export NVIDIA_MODEL=meta/llama3-70b-instruct')
console.log('openclaude')
console.log()
console.log('# 2. Using profile config:')
console.log('bun run build:profile --provider nvidia --api-key nvapi-your-key-here')
console.log('openclaude')
console.log()
console.log('# 3. Direct CLI arguments:')
console.log('openclaude --provider nvidia --api-key nvapi-your-key-here --model meta/llama3-70b-instruct')
console.log()
console.log('======================================')
console.log('Documentation: docs/nvidia-provider.md')
console.log('======================================')
