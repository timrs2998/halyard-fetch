/**
 * The actual fetch -> freshness-check -> explode -> size-guard -> materialize
 * pipeline for one source, run under that source's lock. Every scheduled
 * tick, "Refresh now", and "Refresh all sources now" funnels through this
 * one function.
 */

import { KeyedAsyncLock } from "./async-lock";
import { checkFreshness, fetchZip, type RequestFn } from "./fetchers";
import { shouldFireFailureNotice } from "./notice-dedup";
import { detectContentRoot, exceedsSizeGuard, explodeZip, extractContentFiles } from "./zip/explode";
import { materialize } from "./materialize";
import type { RefreshTrigger } from "./scheduler";
import type { LogEntry, PluginSettings, RefreshError, RefreshResult, Source, SourceState } from "./types";
import type { VaultAdapterLike } from "./vault-adapter";

/** The one `SecretStore` method this module needs — see `secrets.ts`. */
export interface TokenProvider {
	getToken(tokenRef: string): Promise<string | null>;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}
	return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export interface RefreshOrchestratorDeps {
	lock: KeyedAsyncLock;
	secretStore: TokenProvider;
	adapter: VaultAdapterLike;
	request: RequestFn;
	getSettings(): PluginSettings;
	getState(sourceId: string): SourceState;
	setState(sourceId: string, state: SourceState): void;
	appendLog(sourceId: string, entry: LogEntry): void;
	showFailureNotice(source: Source, error: RefreshError): void;
	now(): number;
}

export function refreshSource(source: Source, trigger: RefreshTrigger, deps: RefreshOrchestratorDeps): Promise<RefreshResult> {
	return deps.lock.run(source.id, () => runRefreshUnlocked(source, trigger, deps));
}

async function runRefreshUnlocked(source: Source, _trigger: RefreshTrigger, deps: RefreshOrchestratorDeps): Promise<RefreshResult> {
	const attemptAt = deps.now();
	const settings = deps.getSettings();
	const priorState = deps.getState(source.id);

	function fail(error: RefreshError): RefreshResult {
		deps.setState(source.id, { ...priorState, lastAttemptAt: attemptAt, lastOutcome: error.kind });
		deps.appendLog(source.id, { timestamp: attemptAt, outcome: error.kind, detail: error.message });
		if (shouldFireFailureNotice(priorState.lastOutcome, error.kind)) {
			deps.showFailureNotice(source, error);
		}
		return { ok: false, error };
	}

	function succeed(bytesWritten: number, marker: string, skipped: boolean): RefreshResult {
		deps.setState(source.id, {
			lastAttemptAt: attemptAt,
			lastOutcome: "success",
			lastSuccessAt: attemptAt,
			lastFreshnessMarker: marker,
			lastBytesWritten: bytesWritten,
		});
		deps.appendLog(source.id, {
			timestamp: attemptAt,
			outcome: "success",
			detail: skipped ? "Unchanged upstream — skipped download" : `${formatBytes(bytesWritten)} written`,
		});
		return skipped ? { ok: true, skipped: true, freshnessMarker: marker } : { ok: true, bytesWritten, freshnessMarker: marker };
	}

	const token = await deps.secretStore.getToken(source.tokenRef);
	if (token === null) {
		return fail({ kind: "auth-failure", message: "No token configured for this source" });
	}

	const freshness = await checkFreshness(source, token, deps.request);
	if (!freshness.ok) return fail(freshness.error);

	if (priorState.lastFreshnessMarker !== undefined && priorState.lastFreshnessMarker === freshness.value.marker) {
		return succeed(priorState.lastBytesWritten ?? 0, freshness.value.marker, true);
	}

	const fetched = await fetchZip(source, token, deps.request);
	if (!fetched.ok) return fail(fetched.error);

	const maxSizeMB = source.maxSizeMB ?? settings.defaultMaxSizeMB;
	if (exceedsSizeGuard(fetched.value.bytes.byteLength, maxSizeMB)) {
		return fail({ kind: "size-exceeded", message: `Artifact exceeds the configured ${maxSizeMB} MB limit` });
	}

	let unzipped: ReturnType<typeof explodeZip>;
	try {
		unzipped = explodeZip(fetched.value.bytes);
	} catch (e) {
		return fail({ kind: "content-root-mismatch", message: `Could not read zip: ${(e as Error).message}` });
	}

	let contentRoot = source.contentRootPath;
	if (contentRoot === undefined) {
		const detection = detectContentRoot(Object.keys(unzipped));
		if (detection.autoDetected === null) {
			return fail({
				kind: "content-root-mismatch",
				message: "Zip layout changed — the top-level folder could not be auto-detected; reconfigure this source's content root",
			});
		}
		contentRoot = detection.autoDetected;
	}

	const files = extractContentFiles(unzipped, contentRoot);

	try {
		const result = await materialize(deps.adapter, source.destinationFolder, files);
		return succeed(result.bytesWritten, fetched.value.marker, false);
	} catch (e) {
		return fail({ kind: "materialize-failure", message: (e as Error).message });
	}
}
