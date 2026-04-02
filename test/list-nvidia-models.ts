#!/usr/bin/env bun run
/**
 * list-nvidia-models.ts
 * List all available NVIDIA models and search for specific ones
 */

const API_KEY = process.env.NVIDIA_API_KEY

if (!API_KEY) {
  console.error('❌ Error: NVIDIA_API_KEY environment variable is not set!')
  console.error('\nUsage:')
  console.error('  export NVIDIA_API_KEY="nvapi-your-key-here"')
  console.error('  bun run list-nvidia-models.ts [search-term]')
  process.exit(1)
}

const searchTerm = process.argv[2]?.toLowerCase()
const BASE_URL = "https://integrate.api.nvidia.com/v1"

async function listModels() {
  try {
    console.log('Fetching available NVIDIA models...\n')
    
    const response = await fetch(`${BASE_URL}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()
    const models = data.data || []
    
    console.log(`Found ${models.length} total models\n`)
    
    let filtered = models
    
    if (searchTerm) {
      console.log(`Searching for: "${searchTerm}"\n`)
      filtered = models.filter((m: any) => 
        m.id.toLowerCase().includes(searchTerm)
      )
      
      if (filtered.length === 0) {
        console.log(`❌ No models found matching "${searchTerm}"`)
        console.log('\nAvailable models include:')
        models.slice(0, 20).forEach((m: any) => {
          console.log(`  - ${m.id}`)
        })
        return false
      }
    }
    
    // Display models
    filtered.forEach((model: any) => {
      console.log(`✓ ${model.id}`)
      if (model.name && model.name !== model.id) {
        console.log(`  Name: ${model.name}`)
      }
      if (model.owner) {
        console.log(`  Owner: ${model.owner}`)
      }
    })
    
    if (filtered.length > 50) {
      console.log(`\n... showing ${filtered.length} models (use search term to filter)`)
    }
    
    return true
  } catch (error) {
    console.error('❌ Error fetching models:')
    console.error(error)
    return false
  }
}

listModels().then(success => {
  process.exit(success ? 0 : 1)
})
