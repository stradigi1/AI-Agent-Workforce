#!/bin/bash
set -e

echo "Running post-merge setup..."

# Install dependencies
npm install

# Run DB migrations (safe to re-run — all IF NOT EXISTS)
npm run migrate

echo "Post-merge setup complete."
