/**
 * Optional interop with Halyard Sync when it shares the vault. Destination
 * folders — and this plugin's `data.json`, which can hold plaintext fallback
 * tokens — are registered with Halyard Sync's ignore list, so mirrored
 * machine-generated content is never staged, committed, or caught in a
 * checkout/merge race with Halyard Sync's own periodic sync.
 *
 * A structural probe, not a dependency. Halyard Sync may be absent, or old
 * enough to predate `registerExternalIgnorePattern`; either way this
 * degrades to a no-op.
 */

export interface IgnoreRegistrar {
	registerExternalIgnorePattern(pattern: string): Promise<boolean>;
}

export function detectHalyardSync(app: unknown): IgnoreRegistrar | null {
	const plugins = (app as { plugins?: { plugins?: Record<string, unknown> } } | null | undefined)?.plugins?.plugins;
	const candidate = plugins?.["halyard-sync"] as { registerExternalIgnorePattern?: unknown } | undefined;
	if (candidate === undefined || typeof candidate.registerExternalIgnorePattern !== "function") return null;
	return candidate as unknown as IgnoreRegistrar;
}

/** Halyard Sync's ignore matcher treats a trailing "/" as "this folder and everything under it" — see its `matchPattern`. */
export function folderIgnorePattern(destinationFolder: string): string {
	return destinationFolder.endsWith("/") ? destinationFolder : `${destinationFolder}/`;
}
