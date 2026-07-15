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
