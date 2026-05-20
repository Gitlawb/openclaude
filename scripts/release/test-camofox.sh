#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../.."
node scripts/release/camofox-control.mjs test
