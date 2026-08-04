# En Play

En Play reads vocabulary tables from Obsidian, stores learning state in SQLite, and provides separate new-word and review workflows through a local TypeScript web application.

## Run

```bash
pnpm install
pnpm build
pnpm start
```

Open `http://127.0.0.1:4173` or the Obsidian note `en/study/en-play.md`.

Use **同步词库** after the service starts. Importing is idempotent and does not modify the source Markdown files.

## Desktop App (macOS)

```bash
pnpm install
pnpm release
```

This builds the web frontend, bundles the server with esbuild, and runs electron-builder. Unsigned DMGs (arm64 and x86_64) are written to `apps/desktop/release/`; on first launch use right-click → Open.

The desktop app runs the Fastify server inside the Electron main process and loads it from a loopback address. Its database lives at `~/Library/Application Support/En Play/en-play.sqlite3`; on first launch, an existing legacy database at `data/en-play.sqlite3` (including WAL files) is migrated automatically.

For desktop shell development, run `pnpm dev:desktop`.

To publish a release, push a `v*` tag: the GitHub Actions workflow builds the DMGs and uploads them to a GitHub Releases draft.

## Validate

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## Data

- SQLite: `data/en-play.sqlite3`
- Backups: `backups/en-play-YYYY-MM-DD.sqlite3`
- Source vocabulary: `/Users/linctex/Projects/obsidian/en/english-words*.md`
- Review snapshot: `/Users/linctex/Projects/obsidian/en/study/review-queue.md`
- Daily reports: `/Users/linctex/Projects/obsidian/en/study/reports/YYYY-MM-DD.md`

## Current Scope

The MVP includes Markdown import, stable source-position IDs, SQLite migrations, D1/D3/D7/D14/D21 scheduling, weekend handling, idempotent sessions, local API, responsive UI, Markdown snapshots, and SQLite backup.

The current content generator is deterministic and selects entries in source order. Semantic word grouping, passage generation, open-answer evaluation, and installation of weekday automations remain behind explicit adapters until their Codex execution method and run times are confirmed.
