/**
 * GitHub Releases fetcher. Freshness check and download both resolve the
 * release metadata first (cheap JSON, not the asset binary). The marker is
 * the release id plus publish timestamp, so editing or republishing a
 * release invalidates it.
 */

import type { GithubReleaseSource } from "../types";
import { classifyHttpStatus, requestWithRateLimitRetry, type FetcherOutcome, type RequestFn } from "./http";

interface GithubAsset {
	id: number;
	name: string;
}

interface ResolvedRelease {
	marker: string;
	asset: GithubAsset;
}

function releaseUrl(source: GithubReleaseSource): string {
	const suffix = source.tag === "latest" ? "releases/latest" : `releases/tags/${encodeURIComponent(source.tag)}`;
	return `https://api.github.com/repos/${source.repo}/${suffix}`;
}

function authHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
}

function parseJson(arrayBuffer: ArrayBuffer): unknown {
	return JSON.parse(new TextDecoder().decode(arrayBuffer));
}

async function resolveRelease(
	source: GithubReleaseSource,
	token: string,
	request: RequestFn
): Promise<FetcherOutcome<ResolvedRelease>> {
	const response = await requestWithRateLimitRetry(request, {
		url: releaseUrl(source),
		method: "GET",
		headers: authHeaders(token),
	});
	if (response.status < 200 || response.status >= 300) {
		return { ok: false, error: { kind: classifyHttpStatus(response.status), message: `GitHub release lookup failed (HTTP ${response.status})` } };
	}

	const body = parseJson(response.arrayBuffer) as {
		id: number;
		published_at: string;
		assets: GithubAsset[];
	};

	const asset = source.assetName
		? body.assets.find((a) => a.name === source.assetName)
		: body.assets.length === 1
			? body.assets[0]
			: undefined;

	if (!asset) {
		const message =
			body.assets.length === 0
				? "Release has no assets"
				: source.assetName
					? `No asset named "${source.assetName}" on this release`
					: `Release has ${body.assets.length} assets; configure assetName to pick one`;
		return { ok: false, error: { kind: "not-found", message } };
	}

	return { ok: true, value: { marker: `${body.id}:${body.published_at}`, asset } };
}

export async function githubCheckFreshness(
	source: GithubReleaseSource,
	token: string,
	request: RequestFn
): Promise<FetcherOutcome<{ marker: string }>> {
	const resolved = await resolveRelease(source, token, request);
	if (!resolved.ok) return resolved;
	return { ok: true, value: { marker: resolved.value.marker } };
}

export async function githubFetchZip(
	source: GithubReleaseSource,
	token: string,
	request: RequestFn
): Promise<FetcherOutcome<{ bytes: Uint8Array; marker: string }>> {
	const resolved = await resolveRelease(source, token, request);
	if (!resolved.ok) return resolved;

	const assetUrl = `https://api.github.com/repos/${source.repo}/releases/assets/${resolved.value.asset.id}`;
	const response = await requestWithRateLimitRetry(request, {
		url: assetUrl,
		method: "GET",
		headers: { ...authHeaders(token), Accept: "application/octet-stream" },
	});
	if (response.status < 200 || response.status >= 300) {
		return { ok: false, error: { kind: classifyHttpStatus(response.status), message: `GitHub asset download failed (HTTP ${response.status})` } };
	}

	return { ok: true, value: { bytes: new Uint8Array(response.arrayBuffer), marker: resolved.value.marker } };
}
