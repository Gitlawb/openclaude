#!/usr/bin/env bun run
/**
 * test-nvidia-verification.ts
 * Verify NVIDIA NVCF API connectivity with real credentials
 * 
 * Usage:
 *   export NVIDIA_API_KEY="your-key-here"
 *   bun run test-nvidia-verification.ts
 */

const API_KEY = process.env.NVIDIA_API_KEY
const MODEL = process.env.NVIDIA_MODEL || "meta/llama3-8b-instruct"
const BASE_URL = "https://integrate.api.nvidia.com/v1"

if (!API_KEY) {
  console.error('❌ Error: NVIDIA_API_KEY environment variable is not set!')
  console.error('\nUsage:')
  console.error('  export NVIDIA_API_KEY="nvapi-your-key-here"')
  console.error('  bun run test-nvidia-verification.ts')
  console.error('\nGet your API key from: https://build.nvidia.com/')
  process.exit(1)
}

console.log('======================================')
console.log('NVIDIA NVCF API Verification Test')
console.log('======================================\n')

console.log(`Testing endpoint: ${BASE_URL}/chat/completions`)
console.log(`Model: ${MODEL}`)
console.log(`API Key: ${API_KEY.slice(0, 10)}...${API_KEY.slice(-4)}\n`)

async function testConnection() {
  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'user', content: 'Hello! This is a test message from OpenClaude NVIDIA provider verification.' }
        ],
        max_tokens: 50,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    })

    console.log(`Response Status: ${response.status} ${response.statusText}\n`)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ Request failed:')
      console.error(errorText)
      return false
    }

    const data = await response.json()
    
    console.log('✅ Success! Response received:\n')
    console.log('Response ID:', data.id)
    console.log('Model:', data.model)
    console.log('Choices:', data.choices?.length || 0)
    
    if (data.choices && data.choices.length > 0) {
      const content = data.choices[0].message?.content
      console.log('\nAssistant Response:')
      console.log(content?.slice(0, 200) + (content?.length > 200 ? '...' : ''))
    }

    if (data.usage) {
      console.log('\nUsage:')
      console.log('  Prompt Tokens:', data.usage.prompt_tokens)
      console.log('  Completion Tokens:', data.usage.completion_tokens)
      console.log('  Total Tokens:', data.usage.total_tokens)
    }

    console.log('\n======================================')
    console.log('✅ NVIDIA API verification PASSED!')
    console.log('======================================\n')
    
    return true
  } catch (error) {
    console.error('❌ Error during verification:')
    console.error(error)
    console.log('\n======================================')
    console.log('❌ NVIDIA API verification FAILED')
    console.log('======================================\n')
    return false
  }
}

// Also list available models
async function listModels() {
  try {
    console.log('\nFetching available models...\n')
    
    const response = await fetch(`${BASE_URL}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      signal: AbortSignal.timeout(10000),
    })

    if (response.ok) {
      const data = await response.json()
      const models = data.data || []
      
      console.log(`Found ${models.length} models:\n`)
      
      // Show first 10 models
      models.slice(0, 10).forEach((model: any) => {
        console.log(`  - ${model.id}`)
      })
      
      if (models.length > 10) {
        console.log(`  ... and ${models.length - 10} more`)
      }
    } else {
      console.log('Could not fetch models list')
    }
  } catch (error) {
    console.log('Could not fetch models list:', error)
  }
}

async function main() {
  const success = await testConnection()
  
  if (success) {
    await listModels()
  }
  
  process.exit(success ? 0 : 1)
}

main()
