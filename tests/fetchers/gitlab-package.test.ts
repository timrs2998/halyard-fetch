import { describe, expect, it, vi } from "vitest";
import { gitlabCheckFreshness, gitlabFetchZip } from "../../src/fetchers/gitlab-package";
import type { HttpResponse, RequestFn } from "../../src/fetchers/http";
import type { GitlabPackageSource } from "../../src/types";
import { anyString } from "../helpers/matchers";
import { requestCalls } from "../helpers/mocks";

const source: GitlabPackageSource = {
	kind: "gitlab-package",
	projectId: "123",
	packageName: "team-handbook",
	version: "latest",
	fileName: "team-handbook.zip",
};

function ok(headers: Record<string, string> = {}, body = new ArrayBuffer(0)): HttpResponse {
	return { status: 200, headers, arrayBuffer: body };
}

describe("gitlabCheckFreshness", () => {
	it("issues a HEAD request against the exact package-registry download URL", async () => {
		const request: RequestFn = vi.fn().mockResolvedValue(ok({ etag: '"abc"' }));
		await gitlabCheckFreshness(source, "tok", request);
		expect(request).toHaveBeenCalledWith({
			url: "https://gitlab.com/api/v4/projects/123/packages/generic/team-handbook/latest/team-handbook.zip",
			method: "HEAD",
			headers: { "PRIVATE-TOKEN": "tok" },
		});
	});

	it("uses a self-managed baseUrl when configured", async () => {
		const request: RequestFn = vi.fn().mockResolvedValue(ok());
		await gitlabCheckFreshness({ ...source, baseUrl: "https://gitlab.example.com/" }, "tok", request);
		const url = requestCalls(request)[0]?.[0].url;
		expect(url).toBe("https://gitlab.example.com/api/v4/projects/123/packages/generic/team-handbook/latest/team-handbook.zip");
	});

	it("returns a marker derived from ETag/Last-Modified/Content-Length", async () => {
		const request: RequestFn = vi.fn().mockResolvedValue(ok({ etag: '"abc"', "last-modified": "Mon", "content-length": "10" }));
		const result = await gitlabCheckFreshness(source, "tok", request);
		expect(result).toEqual({ ok: true, value: { marker: '"abc":Mon:10' } });
	});

	it("classifies a 401 as auth-failure", async () => {
		const request: RequestFn = vi.fn().mockResolvedValue({ status: 401, headers: {}, arrayBuffer: new ArrayBuffer(0) });
		const result = await gitlabCheckFreshness(source, "tok", request);
		expect(result).toEqual({ ok: false, error: { kind: "auth-failure", message: anyString() } });
	});

	it("classifies a 404 as not-found", async () => {
		const request: RequestFn = vi.fn().mockResolvedValue({ status: 404, headers: {}, arrayBuffer: new ArrayBuffer(0) });
		const result = await gitlabCheckFreshness(source, "tok", request);
		expect(result).toEqual({ ok: false, error: { kind: "not-found", message: anyString() } });
	});
});

describe("gitlabFetchZip", () => {
	it("GETs the same URL and returns the raw bytes plus a marker", async () => {
		const bytes = new Uint8Array([1, 2, 3]).buffer;
		const request: RequestFn = vi.fn().mockResolvedValue(ok({ etag: '"xyz"' }, bytes));
		const result = await gitlabFetchZip(source, "tok", request);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.from(result.value.bytes)).toEqual([1, 2, 3]);
			expect(result.value.marker).toBe('"xyz"::');
		}
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({ method: "GET", headers: { "PRIVATE-TOKEN": "tok" } })
		);
	});

	it("surfaces a transient error on a 5xx", async () => {
		const request: RequestFn = vi.fn().mockResolvedValue({ status: 503, headers: {}, arrayBuffer: new ArrayBuffer(0) });
		const result = await gitlabFetchZip(source, "tok", request);
		expect(result).toEqual({ ok: false, error: { kind: "transient", message: anyString() } });
	});
});
