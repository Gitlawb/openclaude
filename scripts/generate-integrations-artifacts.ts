import { generatedIntegrationArtifactsAreCurrent, writeIntegrationArtifacts } from '../src/integrations/artifactGenerator.js'

const shouldCheck = process.argv.includes('--check')

if (shouldCheck) {
  const isCurrent = await generatedIntegrationArtifactsAreCurrent()
  if (!isCurrent) {
    console.error(
      'Integration artifacts are out of date. Run `bun run scripts/generate-integrations-artifacts.ts`.',
    )
    process.exit(1)
  }

  console.log('Integration artifacts are up to date.')
} else {
  const artifacts = await writeIntegrationArtifacts()
  for (const artifact of artifacts) {
    console.log(`Wrote ${artifact.path}`)
  }
}
