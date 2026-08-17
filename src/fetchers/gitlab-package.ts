/**
 * GitLab Generic Package Registry fetcher. A HEAD request against the
 * download URL serves as the cheap freshness check; hosts that reject HEAD
 * fall through to a full download.
 */

import type { GitlabPackageSource } from "../types";
import { classifyHttpStatus, requestWithRateLimitRetry, type FetcherOutcome, type RequestFn } from "./http";

function downloadUrl(source: GitlabPackageSource): string {
	const base = (source.baseUrl ?? "https://gitlab.com").replace(/\/+$/, "");
	const project = encodeURIComponent(source.projectId);
	const pkg = encodeURIComponent(source.packageName);
	const version = encodeURIComponent(source.version);
	const file = encodeURIComponent(source.fileName);
	return `${base}/api/v4/projects/${project}/packages/generic/${pkg}/${version}/${file}`;
}

function marker(headers: Record<string, string>): string {
	const etag = headers["etag"] ?? "";
	const lastModified = headers["last-modified"] ?? "";
	const contentLength = headers["content-length"] ?? "";
	return `${etag}:${lastModified}:${contentLength}`;
}

export async function gitlabCheckFreshness(
	source: GitlabPackageSource,
	token: string,
	request: RequestFn
): Promise<FetcherOutcome<{ marker: string }>> {
	const response = await requestWithRateLimitRetry(request, {
		url: downloadUrl(source),
		method: "HEAD",
		headers: { "PRIVATE-TOKEN": token },
	});
	if (response.status < 200 || response.status >= 300) {
		return { ok: false, error: { kind: classifyHttpStatus(response.status), message: `GitLab package check failed (HTTP ${response.status})` } };
	}
	return { ok: true, value: { marker: marker(response.headers) } };
}

export async function gitlabFetchZip(
	source: GitlabPackageSource,
	token: string,
	request: RequestFn
): Promise<FetcherOutcome<{ bytes: Uint8Array; marker: string }>> {
	const response = await requestWithRateLimitRetry(request, {
		url: downloadUrl(source),
		method: "GET",
		headers: { "PRIVATE-TOKEN": token },
	});
	if (response.status < 200 || response.status >= 300) {
		return { ok: false, error: { kind: classifyHttpStatus(response.status), message: `GitLab package download failed (HTTP ${response.status})` } };
	}
	return { ok: true, value: { bytes: new Uint8Array(response.arrayBuffer), marker: marker(response.headers) } };
}
