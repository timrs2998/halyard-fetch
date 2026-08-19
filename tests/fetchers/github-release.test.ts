import { describe, expect, it, vi } from "vitest";
import { githubCheckFreshness, githubFetchZip } from "../../src/fetchers/github-release";
import type { HttpResponse, RequestFn } from "../../src/fetchers/http";
import type { GithubReleaseSource } from "../../src/types";
import { anyString, objectContaining, stringContaining } from "../helpers/matchers";

const source: GithubReleaseSource = {
	kind: "github-release",
	repo: "acme/ledger",
	tag: "latest",
};

function jsonResponse(body: unknown, status = 200): HttpResponse {
	return {
		status,
		headers: {},
		arrayBuffer: new TextEncoder().encode(JSON.stringify(body)).buffer,
	};
}

function binaryResponse(bytes: number[], status = 200): HttpResponse {
	return { status, headers: {}, arrayBuffer: new Uint8Array(bytes).buffer };
}

const singleAssetRelease = { id: 42, published_at: "2026-07-01T00:00:00Z", assets: [{ id: 99, name: "ledger.zip" }] };

describe("githubCheckFreshness", () => {
	it("resolves the latest release and derives a marker from id + published_at", async () => {
		const request: RequestFn = vi.fn().mockResolvedValue(jsonResponse(singleAssetRelease));
		const result = await githubCheckFreshness(source, "tok", request);
		expect(result).toEqual({ ok: true, value: { marker: "42:2026-07-01T00:00:00Z" } });
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://api.github.com/repos/acme/ledger/releases/latest" })
		);
	});

	it("hits the tagged-release endpoint when tag isn't latest", async () => {
		const request: RequestFn = vi.fn().mockResolvedValue(jsonResponse(singleAssetRelease));
		await githubCheckFreshness({ ...source, tag: "v2" }, "tok", request);
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://api.github.com/repos/acme/ledger/releases/tags/v2" })
		);
	});

	it("auto-picks the asset when there's exactly one", async () => {
		const request: RequestFn = vi.fn().mockResolvedValue(jsonResponse(singleAssetRelease));
		const result = await githubCheckFreshness(source, "tok", request);
		expect(result.ok).toBe(true);
	});

	it("fails with not-found when there are multiple assets and no assetName is configured", async () => {
		const multiAsset = { id: 1, published_at: "x", assets: [{ id: 1, name: "a.zip" }, { id: 2, name: "b.zip" }] };
		const request: RequestFn = vi.fn().mockResolvedValue(jsonResponse(multiAsset));
		const result = await githubCheckFreshness(source, "tok", request);
		expect(result).toEqual({ ok: false, error: { kind: "not-found", message: stringContaining("2 assets") } });
	});

	it("picks the matching asset by assetName among multiple", async () => {
		const multiAsset = { id: 1, published_at: "x", assets: [{ id: 1, name: "a.zip" }, { id: 2, name: "b.zip" }] };
		const request: RequestFn = vi.fn().mockResolvedValue(jsonResponse(multiAsset));
		const result = await githubCheckFreshness({ ...source, assetName: "b.zip" }, "tok", request);
		expect(result.ok).toBe(true);
	});

	it("classifies a 401 as auth-failure", async () => {
		const request: RequestFn = vi.fn().mockResolvedValue(jsonResponse({ message: "Bad credentials" }, 401));
		const result = await githubCheckFreshness(source, "tok", request);
		expect(result).toEqual({ ok: false, error: { kind: "auth-failure", message: anyString() } });
	});
});

describe("githubFetchZip", () => {
	it("resolves the release then downloads the asset via the API asset endpoint", async () => {
		const request: RequestFn = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(singleAssetRelease))
			.mockResolvedValueOnce(binaryResponse([1, 2, 3]));

		const result = await githubFetchZip(source, "tok", request);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.from(result.value.bytes)).toEqual([1, 2, 3]);
			expect(result.value.marker).toBe("42:2026-07-01T00:00:00Z");
		}
		expect(request).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				url: "https://api.github.com/repos/acme/ledger/releases/assets/99",
				headers: objectContaining({ Accept: "application/octet-stream" }),
			})
		);
	});

	it("does not attempt a download when asset resolution fails", async () => {
		const request: RequestFn = vi.fn().mockResolvedValue(jsonResponse({ message: "not found" }, 404));
		const result = await githubFetchZip(source, "tok", request);
		expect(result).toEqual({ ok: false, error: { kind: "not-found", message: anyString() } });
		expect(request).toHaveBeenCalledTimes(1);
	});
});
