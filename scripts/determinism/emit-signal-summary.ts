#!/usr/bin/env bun

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  buildSignalSummary,
  type ArtifactManifest,
  type HistoricalSample,
} from '../../src/determinism/signalSummary.ts'

type Args = {
  left: string
  right: string
  history?: string
  out: string
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--left') {
      args.left = argv[i + 1]
      i++
    } else if (token === '--right') {
      args.right = argv[i + 1]
      i++
    } else if (token === '--history') {
      args.history = argv[i + 1]
      i++
    } else if (token === '--out') {
      args.out = argv[i + 1]
      i++
    }
  }

  return {
    left: args.left ?? '.artifacts/determinism/run1',
    right: args.right ?? '.artifacts/determinism/run2',
    history: args.history,
    out: args.out ?? '.artifacts/determinism/signal-summary.json',
  }
}

async function readManifest(dirPath: string): Promise<ArtifactManifest> {
  const manifestPath = join(dirPath, 'manifest.json')
  const raw = await readFile(manifestPath, 'utf8')
  const parsed = JSON.parse(raw) as ArtifactManifest
  return {
    schemaVersion: parsed.schemaVersion,
    artifacts: [...parsed.artifacts].sort((a, b) => a.file.localeCompare(b.file)),
  }
}

async function readHistoricalSamples(
  historyDir: string,
): Promise<HistoricalSample[]> {
  const entries = await readdir(historyDir, { withFileTypes: true })
  const dirs = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b))

  const samples: HistoricalSample[] = []
  for (const sampleId of dirs) {
    try {
      const manifest = await readManifest(join(historyDir, sampleId))
      samples.push({ sampleId, manifest })
    } catch {
      continue
    }
  }
  return samples
}

async function writeOutput(path: string, value: unknown): Promise<void> {
  const outputPath = resolve(process.cwd(), path)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const leftDir = resolve(process.cwd(), args.left)
  const rightDir = resolve(process.cwd(), args.right)
  const leftManifest = await readManifest(leftDir)
  const rightManifest = await readManifest(rightDir)

  const historicalSamples =
    args.history !== undefined
      ? await readHistoricalSamples(resolve(process.cwd(), args.history))
      : undefined

  const summary = buildSignalSummary({
    leftSampleId: args.left,
    rightSampleId: args.right,
    leftManifest,
    rightManifest,
    historicalSamples,
  })

  await writeOutput(args.out, summary)
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
