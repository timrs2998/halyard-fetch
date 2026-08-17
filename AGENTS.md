# AGENTS.md

Conventions for working in this repository, whether you're a human or an agent.

This plugin was developed with substantial AI assistance (Claude).

## What this plugin is

Tether Fetch downloads a zip from a remote registry, extracts it, and mirrors its
contents into a vault folder. Read-only: there is no code path that writes back to a
source. Keep it that way — it's the plugin's core guarantee, not a default.

## Layout

```
src/
  main.ts                 Plugin entry: lifecycle, commands, ribbon, status bar
  settings.ts             Settings tab
  types.ts                Config and status types; the SourceConfig union
  id.ts                   Source id generation and slugify
  scheduler.ts            Trigger and staleness decisions (pure)
  refresh-orchestrator.ts The fetch -> freshness -> explode -> mirror pipeline
  materialize.ts          Mirror-with-delete-orphans against the vault adapter
  validation.ts           Destination-folder overlap checks (pure)
  notice-dedup.ts         Fires a Notice on transitions only (pure)
  log-store.ts            Capped refresh history (pure)
  async-lock.ts           Per-source serialization
  secrets.ts              Token storage: secretStorage, data.json fallback
  sync-interop.ts         Optional Tether Sync ignore-list registration
  vault-adapter.ts        The DataAdapter subset materialize needs
  fetchers/               Per-source-type HTTP; index.ts dispatches on config.kind
  zip/explode.ts          fflate extraction + content-root detection
  ui/                     Setup wizard, log viewer
tests/                    vitest, mirroring src/ layout
e2e/                      WebdriverIO against real Obsidian
```

## Commands

| Command | What it gates |
|---|---|
| `npm run dev` | esbuild watch → `main.js` |
| `npm run build` | `tsc --noEmit` then production esbuild. **Type errors fail here, not in lint.** |
| `npm run lint` | eslint: dead code and unused imports |
| `npm test` | vitest, ~112 tests, no Obsidian required |
| `npm run test:e2e` | Real Obsidian, desktop and emulated-mobile. Needs `main.js` built first. |

Before opening a PR, all four must pass.

## Testing philosophy

Test against real artifacts, not mocks.

- Zip handling is tested with **real zips built by `fflate`** — single-top-folder,
  zero-top-folder, multi-top-folder, nested-empty-dirs — not a stub that assumes
  extraction worked. Content-root detection is exactly the code that looks correct
  until it meets a real malformed-but-valid zip.
- Pure logic (ids, mirror diffs, scheduling, notice dedup, retry and rate-limit
  handling, overlap validation) is unit-tested directly.
- UI glue (wizard, settings tab, log viewer) is verified by type-checking and
  building rather than unit tests. Don't add brittle DOM assertions for it.
- Fetchers depend on `RequestFn`, never on `requestUrl` directly, so tests inject a
  fake. Keep that seam.

## Hard rules

- **Never commit `data.json`.** It can hold plaintext tokens. It is gitignored;
  leave it that way.
- **Never commit secrets** in tests, fixtures, or docs — no real tokens, no private
  URLs, no personal repository paths.
- `main.js` is build output and is gitignored. Don't edit or commit it.
- Use Obsidian's `requestUrl`, never `fetch` — it bypasses CORS on desktop and
  mobile alike.
- Write only under a source's own configured destination folder.
- `isDesktopOnly: false`, so no Node or Electron APIs, no subprocesses, no
  filesystem access outside `app.vault.adapter`.

## Style

- Tabs for indentation; see `.editorconfig`. Double-quoted strings.
- `noUnusedLocals` and `noUnusedParameters` are on. Prefix intentionally unused
  parameters with `_`.
- Comments explain **why**, not what. Don't narrate history — if a comment describes
  how the code used to work, delete it and let git history carry that.
- Prefer active verbs and short sentences in both comments and user-facing strings.
- Never point users at `DESIGN.md` from UI text; explain the thing in place.

## Releasing

1. Bump `manifest.json`, `package.json` and `versions.json` together.
2. Tag **without** a `v` prefix (`git tag 1.2.3`). Obsidian's validation requires the
   tag to equal `manifest.json`'s version exactly.
3. Pushing the tag runs `.github/workflows/release.yml`, which re-verifies the match
   and attaches `manifest.json`, `main.js` and `styles.css` as individual assets —
   never a zip.
