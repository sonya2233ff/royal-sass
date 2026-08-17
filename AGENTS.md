# AGENTS.md

## Cursor Cloud specific instructions

### What this app is
`royal-sass` is a single Next.js 15 (App Router) proof-of-concept called "Royal SASS" that
compares cafe-staple grocery prices between **Walmart #5831** and **No Frills #3660**. The dev
server runs on port `3000`. Standard scripts live in `package.json` (`dev`, `build`, `start`,
`db:push`, `poc:*`, `cache:*`, etc.); the README covers the demo flow.

### Running it (non-obvious notes)
- Start the dev server with `npm run dev` (this is the development target, not `npm run build`/`start`).
- A `.env` file is required. Copy it from the committed `.env.example` (`cp .env.example .env`).
  The app works out of the box with **no API keys** because it reads shipped JSON catalogs in
  `data/catalog/` and `config/`.
- The **Prisma/SQLite database is not used at runtime** — there is no `PrismaClient` usage anywhere
  in `src/`. Prisma is only needed for `prisma generate` (runs automatically via the `postinstall`
  hook) to produce the client for typegen/build. `npm run db:push` creates `prisma/dev.db` but the
  running app never reads it, so DB setup is optional for the compare feature.
- Core flow / "hello world": open `http://localhost:3000`, products are pre-selected, click
  **"Compare N items"**. Walmart prices come from the shipped catalog cache; No Frills comes from
  its cache (`data/catalog/nofrills_3660_latest.json`) when fresh, otherwise a live API call.
- `OPENWEBNINJA_API_KEY` is only needed for the **"Refresh WM"** button (live Walmart pricing via
  OpenWeb Ninja / RapidAPI). The **"Refresh NF"** button hits the live No Frills API (needs network).
  Neither is required for the cached compare demo.
- Catalogs carry a 72h TTL (`STAPLES_CACHE_STALE_HOURS`). Shipped data may render as "stale" but is
  still usable for comparison; that is expected, not a failure.

### Known gotchas (pre-existing, not env issues)
- `npm run lint` (`next lint`) is deprecated in this Next version and is **interactive** — with no
  committed ESLint config it prompts to configure ESLint and cannot complete non-interactively.
  Lint is effectively not set up in this repo.
- `npm run build` currently **fails typecheck**: `src/domain/entity-match.ts` imports a missing
  module `@/domain/fair-compare`. That file is orphaned (only referenced by `src/poc/*` benchmark
  scripts and `src/lib/product-matches.ts`, none of which are imported by the app routes), so
  `next dev` and the price-compare feature run fine. Do not mistake this for an environment problem.
