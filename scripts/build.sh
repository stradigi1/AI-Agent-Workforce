#!/bin/bash
set -e

echo "=== Production build ==="

echo "Installing dependencies..."
npm install

echo "Running DB migrations..."
npm run migrate

echo "Seeding legal documents (idempotent)..."
npm run seed:legal

echo "Seeding Stradigi admin (idempotent, skipped if env vars not set)..."
node server/db/seedStradigiAdmin.js

echo "=== Build complete ==="
