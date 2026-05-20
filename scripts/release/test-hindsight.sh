#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../.."
node scripts/release/hindsight-control.mjs test
