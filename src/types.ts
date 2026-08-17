/**
 * Shared config and status types. Only the two `SourceConfig` variants below
 * ship today: GitLab Generic Package Registry and GitHub Releases.
 * CI-artifact and plain-URL sources are deliberately deferred; adding one
 * means a new union member plus a matching fetcher, not restructuring this
 * file.
 */

export interface GitlabPackageSource {
	kind: "gitlab-package";
	/** Self-managed instance base URL; omitted means gitlab.com. */
	baseUrl?: string;
	/** Numeric project id or URL-encoded `namespace%2Fproject` path. */
	projectId: string;
	packageName: string;
	/** A package-registry version alias (e.g. "latest") or an exact version. */
	version: string;
	/** The specific file name published within the package (the zip asset). */
	fileName: string;
}

export interface GithubReleaseSource {
	kind: "github-release";
	/** "owner/repo". */
	repo: string;
	/** A release tag, or "latest" for the newest release. */
	tag: string;
	/** Required only when a release has more than one asset. */
	assetName?: string;
}

export type SourceConfig = GitlabPackageSource | GithubReleaseSource;

/**
 * `id` is generated once (see `id.ts`) and immutable afterward — it's the
 * join key for `tokenRef`, the per-source command palette entry, and log
 * history, so it can't shift under a later `displayName` rename.
 */
export interface Source {
	id: string;
	displayName: string;
	config: SourceConfig;
	/** Auto-detected at setup if omitted; see `zip/explode.ts`. */
	contentRootPath?: string;
	/** Relative to vault root. */
	destinationFolder: string;
	/** `SecretStore` key. */
	tokenRef: string;
	/** Overrides `PluginSettings.defaultMaxSizeMB` for this source. */
	maxSizeMB?: number;
	/** Overrides `PluginSettings.mobileWifiOnly` for this source. */
	wifiOnlyOverride?: boolean;
	refreshIntervalMinutes: number;
	refreshOnForeground: boolean;
}

export type RefreshErrorKind =
	| "auth-failure"
	| "not-found"
	| "transient"
	| "content-root-mismatch"
	| "size-exceeded"
	| "materialize-failure";

export interface RefreshError {
	kind: RefreshErrorKind;
	message: string;
}

export type RefreshOutcome = "success" | RefreshErrorKind;

export type RefreshResult =
	| { ok: true; bytesWritten: number; freshnessMarker: string; skipped?: false }
	| { ok: true; skipped: true; freshnessMarker: string }
	| { ok: false; error: RefreshError };

/** One row in the in-app log viewer. */
export interface LogEntry {
	timestamp: number;
	outcome: RefreshOutcome;
	/** Human-readable byte count on success, or the error message on failure. */
	detail: string;
}

/** Persisted per-source runtime state — not user-configured, unlike `Source`. */
export interface SourceState {
	lastAttemptAt?: number;
	lastOutcome?: RefreshOutcome;
	lastSuccessAt?: number;
	/** Compared against a freshly-fetched marker for the cheap freshness check. */
	lastFreshnessMarker?: string;
	lastBytesWritten?: number;
}

export interface PluginSettings {
	sources: Source[];
	/**
	 * `null` means "not yet asked": the first-mobile-launch prompt hasn't run.
	 * Desktop ignores this entirely.
	 */
	mobileWifiOnly: boolean | null;
	defaultMaxSizeMB: number;
}

export function defaultSettings(): PluginSettings {
	return {
		sources: [],
		mobileWifiOnly: null,
		defaultMaxSizeMB: 500,
	};
}
