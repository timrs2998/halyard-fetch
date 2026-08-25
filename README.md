# Halyard Fetch

[![CI](https://github.com/timrs2998/halyard-fetch/actions/workflows/ci.yml/badge.svg)](https://github.com/timrs2998/halyard-fetch/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/timrs2998/halyard-fetch?sort=semver)](https://github.com/timrs2998/halyard-fetch/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Obsidian](https://img.shields.io/badge/Obsidian-%3E%3D1.13.0-7c3aed)](https://obsidian.md)
[![Mobile](https://img.shields.io/badge/mobile-supported-brightgreen)](#)

Pull a generated artifact from a remote registry — a GitLab generic package or a
GitHub release asset — unzip it, and mirror its contents into a vault folder, on a
schedule or on demand.

**Read-only.** No git, no clone, no push, no write path back to the source. The
plugin cannot modify anything outside the folder you point it at.

For the git-based sibling, see [Halyard Sync](https://github.com/timrs2998/halyard-sync),
which syncs a whole vault with a git repository and deliberately excludes this
use case.

## AI disclaimer

This plugin was developed with substantial AI assistance (Claude).

## Source types

| | GitLab Generic Package Registry | GitHub Releases |
|---|---|---|
| Endpoint | `GET /api/v4/projects/:id/packages/generic/:pkg/:version/:file` | Release metadata, then the matching asset |
| Version pin | An exact version or a registry alias (e.g. `latest`) | An exact tag or `latest` |
| Auth | `PRIVATE-TOKEN` header, project-scoped PAT (`read_api`) | `Authorization: Bearer`, fine-grained PAT (`Contents: Read`) |

CI-artifact sources (GitLab CI job artifacts, GitHub Actions artifacts) and plain
authenticated URLs are designed for but not built — see [DESIGN.md](DESIGN.md).

## Installation

**Community plugin directory** — not yet listed; submission is pending.

**BRAT** (beta) — install [BRAT](https://github.com/TfTHacker/obsidian42-brat),
then "Add beta plugin" with `timrs2998/halyard-fetch`.

**Manual** — download `manifest.json`, `main.js` and `styles.css` from the
[latest release](https://github.com/timrs2998/halyard-fetch/releases) into
`<vault>/.obsidian/plugins/halyard-fetch/`, then enable it in
Settings → Community plugins.

## Setup

**Add source** — via the ribbon icon, command palette, or settings tab — opens a
wizard:

1. Pick a host: GitLab or GitHub.
2. Identify the artifact: project and package, or repo and tag, plus a display name.
3. Paste a token. See [Security](#security) for where it goes.
4. Test the connection, or skip it (with confirmation) if you're offline.
5. The wizard downloads the artifact once to detect its content root — the folder
   inside the zip that gets mirrored. It auto-fills when there's exactly one
   top-level folder and asks you to pick when there isn't.
6. Choose a destination folder (it must not overlap another source) and a refresh
   interval.
7. Confirm. The source saves and refreshes immediately.

Editing a source reopens the same wizard, pre-filled, and revalidates on save.

## Scheduling

Each source refreshes on its own interval, optionally whenever Obsidian regains
focus, and once at startup to catch up after being fully quit.

Mobile has no background timer. There, "every N minutes" means "the next time you
open the app after N minutes have passed since the last success" — a staleness
threshold, not a timer. The first mobile launch asks whether scheduled refreshes
should be restricted to Wi-Fi; "Refresh now" always bypasses that.

A freshness check runs before every download, so an unchanged source costs one small
request rather than a full re-download.

## Errors

A failing source shows a Notice, a badge in settings, and an entry in the log viewer
(ribbon, status bar, or the "Open log" command).

Repeated identical failures don't re-notify — only transitions do, meaning the first
failure after a success or a different error than last time. There's no automatic
backoff: a failed source retries on its normal schedule, and "Refresh now" is always
available once you've fixed whatever broke.

## Security

- Tokens go to `app.secretStorage` (OS keychain on desktop) when available. Where it
  isn't, they fall back to this plugin's `data.json` in plaintext, and settings shows
  a warning saying so.
- **Tokens stay on the device they were entered on.** They don't travel with the
  vault or through Obsidian Sync.
- Use the narrowest scope your host offers (see the table above). Two sources sharing
  a host still get independent tokens.
- The plugin writes only under each source's own destination folder, reads only from
  the host, project and package you configure, and never writes back to a source.
- **With [Halyard Sync](https://github.com/timrs2998/halyard-sync) in the same vault**,
  this plugin registers each destination folder and its own `data.json` with Halyard
  Sync's ignore list automatically — best-effort, no hard dependency, and order of
  installation doesn't matter. That keeps mirrored content and any plaintext fallback
  token out of what gets committed and pushed. If Halyard Sync already tracked one of
  those paths, untrack it once manually: adding an ignore pattern doesn't purge
  existing history.

## Limitations

- GitLab Generic Package Registry and GitHub Releases only.
- No CI-artifact or plain-URL sources yet.
- Not yet in the community plugin directory.

## Development

```
npm install
npm run dev      # esbuild watch
npm run build    # tsc --noEmit + production esbuild
npm run lint     # eslint
npm test         # vitest
npm run test:e2e # real Obsidian, driven headlessly via WebdriverIO
```

Pure logic — id generation, content-root detection, mirror-diff computation,
scheduling, notice dedup, retry and rate-limit handling — is unit-tested against real
zip fixtures built with `fflate`, not mocked extraction. UI glue is verified by
type-checking and building.

`npm run test:e2e` uses
[wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service),
which downloads a real Obsidian build (cached in `.obsidian-cache/`, gitignored) and
drives it against the fixture vault in `e2e/vaults/simple` — once as desktop
Obsidian, once under emulated-mobile UI. The first run is slower. Widen the version
matrix with `OBSIDIAN_VERSIONS` (e.g. `"earliest/earliest latest/latest"`).

Architecture and rationale live in [DESIGN.md](DESIGN.md); contributor conventions in
[AGENTS.md](AGENTS.md).

## Releasing

- `npm version x.y.z` — bumps `package.json`, `manifest.json` and `versions.json`
  together, commits, and tags `x.y.z`
- `git push origin main --tags`
- GitHub Actions builds, verifies the tag matches `manifest.json`, and attaches
  `manifest.json`, `main.js` and `styles.css` to the release

No `v` prefix on the tag — Obsidian requires it to equal `manifest.json`'s version
exactly. `.npmrc`'s `tag-version-prefix=""` is what keeps `npm version` from adding one.

## Prior art and credits

- **[obsidian-git](https://github.com/Vinzent03/obsidian-git)** (Vinzent03) — the
  plugin that defined git-in-Obsidian. Halyard Fetch exists because read-only
  artifact ingestion sits outside its scope.
- **[fflate](https://github.com/101arrowz/fflate)** (Arjun Barrett) — zip handling,
  pure JS with no native dependency, which is what makes mobile support possible.
- **[wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service)**
  (Jesse Hines) — end-to-end testing against real Obsidian.
- **[obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin)** —
  build scaffolding conventions (`esbuild.config.mjs`, `version-bump.mjs`,
  `versions.json`).
- **[BRAT](https://github.com/TfTHacker/obsidian42-brat)** (TfTHacker) — the beta
  distribution path used above.

## License

MIT — see [LICENSE](LICENSE). Third-party notices: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
