/**
 * Host-agnostic HTTP plumbing shared by every fetcher. Fetchers depend on
 * `RequestFn` rather than Obsidian's `requestUrl` directly, so tests drive
 * them with a fake instead of a live vault and network. `obsidian-request.ts`
 * supplies the real implementation.
 */

import type { RefreshError, RefreshErrorKind } from "../types";

export interface HttpRequestOptions {
	url: string;
	method?: "GET" | "HEAD";
	headers?: Record<string, string>;
}

export interface HttpResponse {
	status: number;
	/** Keys are lowercase — callers must not rely on original header casing. */
	headers: Record<string, string>;
	arrayBuffer: ArrayBuffer;
}

export type RequestFn = (opts: HttpRequestOptions) => Promise<HttpResponse>;

export type FetcherOutcome<T> = { ok: true; value: T } | { ok: false; error: RefreshError };

/** Maps an HTTP status onto the error kinds the UI and retry logic branch on. */
export function classifyHttpStatus(status: number): RefreshErrorKind {
	if (status === 401 || status === 403) return "auth-failure";
	if (status === 404) return "not-found";
	return "transient";
}

export interface RateLimitRetryOptions {
	/** Caps how long a single attempt will wait on `Retry-After`, even if the header asks for more. */
	maxWaitSeconds?: number;
	sleep?: (ms: number) => Promise<void>;
}

/**
 * Honors a Retry-After header as one bounded wait before the attempt gives
 * up — a single wait-and-retry, not a loop. Distinct from the scheduler's
 * interval-based retry, which governs the gap *between* scheduled attempts.
 */
export async function requestWithRateLimitRetry(
	request: RequestFn,
	opts: HttpRequestOptions,
	options: RateLimitRetryOptions = {}
): Promise<HttpResponse> {
	const maxWaitSeconds = options.maxWaitSeconds ?? 30;
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

	const first = await request(opts);
	if (first.status !== 429) return first;

	const retryAfterHeader = first.headers["retry-after"];
	const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
	if (Number.isNaN(retryAfterSeconds)) return first;

	const waitSeconds = Math.min(retryAfterSeconds, maxWaitSeconds);
	await sleep(waitSeconds * 1000);
	return request(opts);
}
