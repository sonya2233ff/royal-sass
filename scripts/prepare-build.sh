#!/bin/sh
# Local builds stay on SQLite. A postgres DATABASE_URL (or Vercel Postgres vars)
# switches the Prisma provider and creates tables before next build.
set -eu
cd "$(dirname "$0")/.."
eval "$(node scripts/select-prisma-provider.mjs)"
prisma generate
if [ "$PRISMA_PROVIDER" = "postgresql" ]; then
  prisma db push --skip-generate
fi
