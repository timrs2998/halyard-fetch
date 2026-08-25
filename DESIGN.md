# Halyard Fetch — Design

An Obsidian plugin that pulls a generated artifact from a remote registry (GitLab
Package Registry or GitHub Releases today; CI artifacts and plain authenticated URLs
are designed for but deferred), explodes the zip, and mirrors its contents into a
vault folder. Read-only: no git, no push, no write path back to the source. The
plugin cannot modify anything outside the vault it runs in.

No relation to git beyond both being "get external content into a vault" tools. See
[Halyard Sync](https://github.com/timrs2998/halyard-sync) for the git-based sibling;
this plugin exists *because* that one excludes CI and package-artifact ingestion as
out of scope.

## Constraints

1. **No git.** No clone, no commit, no `.git` anywhere. Every source reduces to
   "GET a zip with an auth header, explode it, mirror it into a folder" — a far
   smaller surface than Halyard Sync, with no engine lifecycle, no merge, and no
   conflict states.
2. **Read-only, structurally.** Not a default but a property: no code path writes
   back to any source. Existing Obsidian git plugins can't offer this — obsidian-git's
   submodule support carries a push path — whereas this plugin has none to remove.
3. **No true background execution, and desktop and mobile differ sharply.**
   - **Desktop**: `registerInterval` timers fire as long as the Obsidian process
     runs. The window needs neither focus nor visibility; minimized is fine.
     Chromium throttles timers on occluded pages, which can coarsen precision over a
     long stretch. The only real gap is "Obsidian fully quit", which
     catch-up-on-launch covers.
   - **Mobile**: a hard constraint, not a throttling one. iOS suspends the webview's
     JS after roughly 10 minutes backgrounded and Android throttles similarly, so
     "foreground" means the app the user is currently looking at.
   - The practical consequence: on mobile `refreshIntervalMinutes` cannot mean "a
     timer firing every N minutes", because no background timer exists. It means
     "the minimum staleness this source tolerates before the next foreground-open or
     app-launch triggers a refresh." Documented explicitly in "Scheduling" so no
     mobile user discovers it by filing an issue saying "it never syncs".
4. **Zip layout is a producer/consumer contract, and it breaks in practice.** An
   upstream layout change silently invalidates a hardcoded top-level folder name.
   The wizard detects the content root from the real downloaded zip at setup time
   rather than assuming one — see "Explode & materialize".
5. **Tokens belong in the OS keychain.** Obsidian >=1.11's `app.secretStorage`
   (keychain-backed on desktop) is the primary store, with a documented plaintext
   `data.json` fallback where it is unavailable. Same pattern Halyard Sync uses.
6. **Cross-platform, with no native dependency.** The `fflate`-based design (see
   "Tooling") keeps the plugin pure JS, so the same code runs on Windows, macOS,
   Linux, iOS and Android — which is what makes `isDesktopOnly: false` honest rather
   than aspirational.

## Source types

Three shapes, unified behind one `fetch(source) -> zip bytes` interface.

A package or release registry with a `latest` alias is decoupled from any pipeline
run: anything can publish to it, from CI or not, on any schedule. CI-artifact APIs
are keyed to a *pipeline run* instead — no pipeline, no artifact, however fresh the
underlying data is. That difference is why shape 1 is the primary, best-supported
source type and shape 2 is deferred.

1. **Named artifact at a version alias** (GitLab Generic Package Registry, GitHub
   Releases assets). The v1 source type.
   - GitLab: `GET /api/v4/projects/:id/packages/generic/:package/:version/:file`,
     `PRIVATE-TOKEN` header.
   - GitHub: `GET /repos/:owner/:repo/releases/:tag/assets` (or `/latest` for the
     newest release) to resolve the asset id, then the asset download URL, `Bearer`
     token via `Authorization` header.
2. **Most recent CI job artifact** (GitLab CI job artifacts, GitHub Actions
   artifacts). Worth supporting for producers that can't move off CI-triggered
   publishing, but carries the pipeline-coupling fragility above. Deferred.
   - GitLab: `GET /projects/:id/jobs/artifacts/:ref/download?job=:name`.
   - GitHub: list `/repos/:owner/:repo/actions/artifacts`, pick newest matching name,
     `GET .../artifacts/:id/zip`.
3. **Plain authenticated URL returning a zip.** The escape hatch every other shape
   reduces to — one config field (URL + header template), no host-specific code.
   Cheap to add, and covers anything not worth a dedicated integration.

All three funnel into the same explode/materialize path — the only thing that varies
per source type is how the zip's bytes and an optional freshness marker (ETag,
version id, job id — whatever's cheap to check before downloading the whole zip) get
obtained.

## Auth

Per-source token, stored via `app.secretStorage` keyed by a source id (not by host —
unlike Halyard Sync, two sources can share a host but need different, least-privilege
tokens, which a per-host key could not express
demonstrates is a real requirement, not a hypothetical one). Settings UI: one PAT
field per configured source, with per-source-type guidance (GitLab: `read_api` scope;
GitHub: fine-grained PAT with `Contents: Read` for Releases, `Actions: Read` for
Actions artifacts). No OAuth device flow anywhere — none of these APIs have one worth
building against for a read-only integration; PAT-only, matching how Halyard Sync
already treats every provider without a device grant.

**SecretStorage availability.** `app.secretStorage` needs Obsidian >=1.11 (see
Constraints #5); on an older install, or any environment where the OS keychain isn't
reachable (rare, but the API can fail), storing a token falls back to `data.json`
directly with a persistent warning banner in settings, the same tradeoff Halyard Sync
already accepts rather than silently downgrading security with no signal.

**Cross-device portability.** Tokens don't travel with the vault: `app.secretStorage`
is scoped to the local OS keychain, not synced by Obsidian Sync/iCloud/whatever moves
the vault itself. Opening the same vault on a second device shows the configured
sources with no valid token until each is re-entered there, worth surfacing in the
wizard's confirm step ("token is local to this device") rather than letting a user
discover it only when a second-device refresh fails with an auth error.

## Explode & materialize

- Download to a temp path, extract, locate the content root inside the extracted
  tree. Fail loudly and specifically when the expected path is wrong — a named,
  actionable error, never a silent partial sync — but make that path configurable
  per source rather than hardcoded, and auto-detect the
  common case (a zip with exactly one top-level folder) so most sources need no
  configuration at all.
- Materialize with mirror semantics: added/changed files copied in, files no longer
  present upstream removed from the vault folder — mirror-with-delete semantics,
  reimplemented directly against `app.vault.adapter` rather than shelling out (no
  subprocess on mobile).
- Same local-edit caveat as the git-mirror discussion: Obsidian has no API to make a
  folder genuinely read-only in the editor, so this is enforced at sync time (always
  overwrite what's under the destination folder) with a warning surfaced once before
  the first clobber, not a hard block on typing there between refreshes.
- **Halyard Sync interop, implemented (see `sync-interop.ts`).** A source's
  `destinationFolder` (and this plugin's own `data.json`, which can hold plaintext
  fallback tokens — see "Auth") are registered with Halyard Sync's `ignoreGlobs` via
  a structural probe of `app.plugins.plugins["halyard-sync"]` for a
  `registerExternalIgnorePattern(pattern)` method, not a hard dependency — Halyard
  Sync being absent, older, or erroring degrades to a silent no-op. Registration
  happens at plugin load (own `data.json`) and inside `upsertSource` (destination
  folder), *awaited* before the wizard's post-confirm first refresh runs, so the
  folder is excluded from Halyard Sync's tracked tree before it's ever populated —
  it's never committed in the first place, not committed-then-later-ignored. This
  is what actually resolves the race between Halyard Sync's periodic
  commit/checkout cycle and this plugin's own materialize step (see "Constraints"
  and the multi-device sync review this was flagged in): a path that has never
  been staged can't appear in any commit's tree, so no checkout/merge on any
  device ever has a reason to touch it, and no non-atomic partial write from
  materialize can ever be captured mid-commit. **Caveat for a vault where the
  folder or `data.json` was already tracked before this shipped**: adding an
  ignore pattern only stops *future* staging — it doesn't retroactively remove
  already-committed history, so an existing vault needs a one-time manual
  untrack (equivalent to `git rm -r --cached`) on top of this for full effect;
  that step is deliberately not automated here given how hard-to-reverse
  history-rewriting operations are.
- A soft max-size guard before extracting (default 500 MB, overridable per source in
  advanced settings). These are trusted, self-controlled producers, not arbitrary
  internet zips, so this isn't an anti-abuse control; it's a sanity check against the
  more likely failure (a misconfigured source pointed at the wrong package/tag, or a
  URL-type source whose endpoint started returning something unexpected) surfacing as
  a clear, immediate "artifact exceeds the configured size limit" error instead of a
  slow disk-fill during materialize.

## Setup flow (adding a source)

A guided, multi-step wizard — not a single flat form. The config model has enough
interdependent fields (host/type determine which auth-scope guidance and identifier
fields apply; the content root can't be known until a zip is actually fetched) that a
flat form invites saving a broken source and only discovering it at the next
scheduled tick. The wizard front-loads that validation to setup time instead.

1. **Host & type.** Pick GitLab or GitHub, then the source type (package /
   ci-artifact / url — see "Source types"). v1 implements type 1 (package/release)
   end-to-end; types 2 and 3 appear in the picker marked "coming soon" rather than
   hidden, so the config model and wizard shape don't need to change when they land.
2. **Identify the artifact.** Type/host-specific fields: GitLab wants project
   id/path + package name + version; GitHub wants owner/repo + release tag (or
   "latest"). Inline field-level guidance, not a generic help link.
3. **Token.** Paste a PAT, with the scope guidance from "Auth" shown inline
   (`read_api` for GitLab, `Contents: Read` for GitHub Releases). Stored to
   `app.secretStorage` immediately under the source's generated `tokenRef`, not held
   in wizard state — a wizard abandoned partway never leaves a token sitting around
   in plain settings state.
4. **Test connection.** Calls the cheap metadata/freshness-check endpoint (not a full
   zip download) and reports pass/fail inline against this step. Failure blocks
   "Next" by default; an explicit "skip and save anyway" escape hatch exists for
   legitimate offline/rate-limited setup, but takes an extra confirmation click so
   it's never the accidental default.
5. **Content root.** Only reachable after step 4 passes (it needs the real zip).
   Downloads once and inspects the top level: exactly one folder auto-fills
   `contentRootPath` for confirmation; zero or more than one lists what was actually
   found and requires the user to pick or type the path explicitly — this is the
   wizard-time version of the "upstream layout changed" failure the existing
   scripts hit at runtime, caught before the source ever goes live.
6. **Destination & schedule.** Vault folder picker for `destinationFolder`
   (validated against every other configured source's destination so two sources can
   never target overlapping folders), `refreshIntervalMinutes`, `refreshOnForeground`.
7. **Confirm.** Saves the `Source` entry and immediately runs one real fetch +
   materialize (not just the cheap check from step 4), so the wizard's last screen
   shows the source already populated with its first real status, not an empty
   promise that the config will work at the next scheduled tick.

Editing an existing source reopens the same wizard pre-filled, rather than a separate
edit form — one code path for "add" and "edit," and it re-runs the same validation on
save, which catches drift (an expired token, a renamed package) even for a source
that worked fine when it was first configured.

## Scheduling

Same shape as Halyard Sync's scheduler (interval + on-foreground + manual "Refresh
now" command + catch-up-on-launch), because the constraint producing that design
(no background execution) is identical here. Per-source interval, not global: sources
update at genuinely different cadences, and a single global interval would force the
slowest one on everything.
A cheap freshness check (compare the source's version/job id against last-seen)
before downloading the full zip, mirroring the "cheap ref check" already used
elsewhere, so a foreground tick on an unchanged source costs one small request, not
a full re-download.

**Concurrency.** Each source has its own single-flight guard: a scheduled tick,
"Refresh now" for that specific source, and "Refresh all sources now" all funnel
through the same per-source lock, so a manual refresh triggered mid-scheduled-fetch
waits for the in-flight attempt to finish rather than racing a second
fetch/materialize against the same destination folder (the exact class of bug Halyard
Sync's own `AsyncLock` exists to prevent, just scoped per-source here instead of
per-vault). Sources never lock each other: "Refresh all" fans out independently,
since two sources share nothing (different hosts, tokens, destinations) and there's
no reason a slow source should stall a fast one sitting right next to it.

**On mobile, `refreshIntervalMinutes` is a staleness threshold, not a timer.** There
is no background execution to fire it on schedule (see Constraints #3) — a source
configured for "every 4 hours" simply refreshes the next time the app is foregrounded
or launched *if* at least 4 hours have passed since its last successful refresh,
otherwise that foreground tick is a no-op. This is the same underlying mechanism
desktop uses for its own foreground/catch-up checks, but on mobile it's the *only*
mechanism, not a supplement to a real timer — worth naming explicitly in the setup
wizard's schedule step (a short inline note, not just in this doc) so a mobile user
doesn't set "every 15 minutes" and conclude the plugin is broken when it only
actually refreshes once a day because that's how often they open the app.

**Cellular data.** The first time the plugin runs on a mobile platform, a one-time
prompt asks whether scheduled/on-foreground refreshes should be restricted to Wi-Fi
— rather than silently picking a default that's wrong for either a stranger on a
metered plan or one who'd rather not think about it. The answer becomes a global
setting, changeable later from the plugin settings tab, with a per-source override
(mirroring the existing per-source size-guard override) for a source someone knows
is small enough not to matter. Two things always bypass the restriction regardless
of the setting: "Refresh now" (an explicit, one-off user action, not the kind of
surprise the setting exists to prevent) and the wizard's one-time setup downloads
(test connection + content-root detection) — a device offline on Wi-Fi at setup time
shouldn't be blocked from finishing configuration.

## Config model

```
Source {
  id, displayName
  type: "package" | "ci-artifact" | "url"
  host: "gitlab" | "github" | "generic"
  project/repo, package/workflow/artifact name, version or ref
  contentRootPath?: string        // auto-detected if omitted
  destinationFolder: string       // relative to vault root
  tokenRef: string                // secretStorage key
  maxSizeMB?: number              // override of the global default (see "Explode & materialize")
  wifiOnlyOverride?: boolean      // override of the global mobile setting (see "Scheduling")
  refreshIntervalMinutes, refreshOnForeground: bool
}

PluginSettings {
  sources: Source[]
  mobileWifiOnly: boolean         // set via first-mobile-launch prompt (see "Scheduling"); desktop ignores this
  defaultMaxSizeMB: number        // default 500
}
```

A list of `Source`s in settings, each independently configured, refreshed, and
reporting its own status — directly modeling the two (soon to be more?) independent
sources the PowerShell version already has to duplicate a whole script per source to
express. `mobileWifiOnly` and `defaultMaxSizeMB` are the only genuinely global
settings; everything else that could vary per source already does.

`id` is system-generated at creation (`displayName` slugified plus a short random
suffix) and immutable afterward. It's the join key for `tokenRef`, the per-source
command palette entry, and log-viewer history, so it can't shift under a later
rename; `displayName` is the only field the user can freely edit post-creation.

**Removing a source** deletes its settings entry, its `app.secretStorage` token, and
its log-viewer history, but never touches `destinationFolder` — consistent with the
read-only philosophy elsewhere (the plugin only ever overwrites *under* a source's
own destination as part of a refresh; deleting the source config isn't a refresh).
The confirm step warns explicitly that the folder is now unmanaged and won't stay in
sync going forward, rather than silently leaving stale content with no indication
anything changed.

## Error states & retry

| Error | Cause | Where caught |
|---|---|---|
| Auth failure | Invalid, expired, or under-scoped token (401/403) | Freshness check or full fetch |
| Not found | Project/package/release/tag renamed or deleted (404) | Freshness check or full fetch |
| Transient | Timeout, DNS, 5xx, rate limit (429) | Freshness check or full fetch |
| Content-root mismatch | Zip's top-level layout changed since setup | After download, before materialize |
| Materialize failure | Vault adapter write error (disk full, permission denied, path conflict) | During materialize |

All five are surfaced identically — no severity tiers: an Obsidian `Notice` at the
moment of failure, plus a persistent badge next to the source in settings and in the
in-app log viewer (see "UI/UX surfaces"). Simpler than triaging "does this need the
user to act" per error type, and every one of these *does* eventually need the user
to either fix something or shrug it off, so a uniform treatment doesn't hide anything.

**Notice de-duplication.** The Notice fires on a *transition* — first failure after a
success, or a failure whose error type differs from the immediately preceding one —
not on every repeated identical failure. Without this, an expired token left
unattended for days on a 3x/day schedule would fire the same Notice a dozen times
before anyone looks; the settings badge and log viewer stay updated on every attempt
regardless, so nothing is lost, only the interruption is throttled.

**Retry policy: no special backoff.** A failed source simply tries again on its
normal `refreshIntervalMinutes` cadence — same as if the previous attempt had
succeeded. No exponential backoff, no auto-pause. This is deliberately the simplest
option: paired with Notice de-duplication above, a broken source doesn't spam the
user, and "Refresh now" (command palette or status bar) is always available for an
immediate manual retry once the underlying issue (bad token, renamed package) is
fixed. The tradeoff is a source that's broken for a long stretch keeps making doomed
requests on schedule instead of backing off — acceptable given these are
low-frequency (2-3x/day) sources today; worth revisiting if a source with a much
tighter interval is ever added.

**Rate limits (429), specifically.** Within a single attempt, a `Retry-After` header
is honored as a bounded wait before that attempt gives up, distinct from the
interval-based retry above, which governs the gap *between* scheduled attempts, not
behavior within one.

## UI/UX surfaces

A failure must be visible without hunting through a log file. Four surfaces:

- **Ribbon icon.** Left-click triggers "Refresh all sources now" directly (same
  action as the command below) — no dropdown menu, since a single obvious default
  action beats a menu for something used often. Shows a spinner glyph while any
  refresh is in flight, and a small badge when any source is currently in a failing
  state, so the icon doubles as an always-visible status indicator even without
  opening anything.
- **Command palette.** `Halyard Fetch: Refresh all sources now`,
  `Halyard Fetch: Refresh <source displayName> now` (one command per configured
  source, registered/deregistered as sources are added or removed),
  `Halyard Fetch: Add source` (opens the setup wizard), `Halyard Fetch: Open log`.
- **Status bar item.** Persistent bottom-bar entry on desktop: idle state shows a
  small icon only; any source failing shows `N failing` as text. Click opens the
  in-app log viewer directly (not settings) — from "something's wrong" the fastest
  useful next screen is *why*, not the config form. Obsidian mobile's status bar is
  cramped and easy to miss compared to desktop's — needs an actual on-device check
  (iOS + Android) rather than an assumption either way, but if it doesn't read as a
  reliable surface there, the ribbon icon's badge and the log-viewer's own
  reachability from the command palette are the fallback, not a mobile-specific
  redesign.
- **In-app log viewer.** A modal, opened from the status bar, ribbon, or command
  palette: per-source expandable history of refresh attempts (timestamp, outcome,
  byte count or error detail), most recent first. Capped retention (last 50 attempts
  per source, or 30 days, whichever is smaller) so it doesn't grow `data.json`
  unboundedly — this is a debugging aid, not an audit log.

Settings itself (the per-source list from "Config model," each entry showing
last-success/failure time and opening the edit wizard) remains the place to
*configure* a source; the four surfaces above are for *noticing and acting on*
status without opening settings at all.

**Zero-sources state.** On install, before anything is configured, "Refresh all"
would otherwise be a dead action — the ribbon icon and the `Refresh all sources now`
command instead open the setup wizard directly (functionally identical to `Add
source`) when no source exists yet, rather than silently doing nothing or requiring
the user to already know settings exists. The status bar item and settings tab both
show an explicit empty state ("No sources configured — Add source") instead of a
blank or absent widget, so first install doesn't read as "is this even working."

## Tooling

- TypeScript + esbuild, following the same `obsidian-sample-plugin` conventions
  Halyard Sync already uses: single CJS `main.js`, `obsidian`/`electron` external,
  `npm run dev` watch, `version-bump.mjs` + `versions.json`.
- Zip explode: a pure-JS library with no native/WASM dependency (e.g. `fflate`).
  Unlike Halyard Sync's libgit2-over-WASM, there's no reason to compile anything here
  — a zip reader is well inside what plain JS handles, and staying WASM-free is what
  makes mobile support (see "Constraints" and "Publishing") a straightforward v1
  target rather than a second native-binding project.
- Dev deps: `obsidian` (^1.13), `esbuild`, `typescript`, `vitest`. Test strategy
  mirrors Halyard Sync's split rather than mocking everything: pure-logic tests
  (content-root auto-detection, mirror-diff computation, freshness-check comparison,
  Notice-dedup transition logic, destination-folder-overlap validation, `id`
  generation) *and* tests that run the real zip library against real zip fixtures
  (single-top-folder, zero-top-folder, multi-top-folder, nested-empty-dirs) rather
  than a mocked "assume extraction worked" stub — auto-detection is exactly the kind
  of boundary-condition code that looks right until it meets a real
  malformed-but-valid zip.
- **Lint (`eslint.config.mjs`, `npm run lint`):** `eslint:recommended` +
  `typescript-eslint`'s `recommended` config — same setup as Halyard Sync's, for
  the same reasons (see that project's DESIGN.md "Tooling" for the rule-choice
  rationale: `@typescript-eslint/no-unused-vars` and `no-undef` off, superseded
  by tsconfig's `noUnusedLocals`/`noUnusedParameters` and the compiler's own
  ambient-global awareness respectively).
- `manifest.json`: `id: halyard-fetch`, `isDesktopOnly: false` (mobile is a v1
  target — see "Constraints" #3 and #6), `minAppVersion: 1.13.0`. The
  `app.secretStorage` floor from Constraints #5 is only 1.11.0; what raises it
  is the settings tab, which is declarative (`getSettingDefinitions`,
  `settings.ts`) so its rows appear in Obsidian's settings search — that API
  and `ButtonComponent.setDestructive` are both 1.13.0+.

## Publishing

Community plugin directory listing is a real goal. Nothing external gates it: auth
is PAT-only (see "Auth"), so there is no OAuth app to register first.

- **README.md**: what the plugin does, the source-type table, a setup walkthrough,
  and a security note on what's stored where (secretStorage vs. `data.json`
  fallback). Obsidian's review looks for exactly this, not just working code. Done.
- **LICENSE** and `manifest.json`'s `author`/`authorUrl`. Done; `fundingUrl` is
  deliberately unset.
- **No obfuscation**: esbuild's ordinary minification only. Reviewers need to be able
  to read what `main.js` does.
- **GitHub Releases as the distribution mechanism**: each release's assets are
  `manifest.json` + `main.js` (+ `styles.css` if any UI needs it) individually
  attached, matching the format `obsidian-releases`' bot expects — not a zip, not
  buried in a tarball.
- **Submission**: a PR to `obsidian-releases` adding an entry to
  `community-plugins.json`, once the above is done and mobile has been verified on
  a real device. Submitting before then would ship `isDesktopOnly: false` to mobile
  users on a code path only ever exercised on desktop.

## Out of scope

Git (any form — no relation to Halyard Sync's engine). Writing back to any source.
Triggering/managing CI pipelines (this only ever reads a result that already exists).
Arbitrary script execution as part of a source (a source is a fetch+explode+mirror
config, not a hook). SSH (matches Halyard Sync's reasoning — no subprocess on mobile,
HTTPS is the only portable transport anyway for these APIs).
