import { describe, expect, it, vi } from "vitest";
import { classifyHttpStatus, requestWithRateLimitRetry, type HttpResponse, type RequestFn } from "../../src/fetchers/http";

function response(status: number, headers: Record<string, string> = {}): HttpResponse {
	return { status, headers, arrayBuffer: new ArrayBuffer(0) };
}

describe("classifyHttpStatus", () => {
	it("maps 401/403 to auth-failure", () => {
		expect(classifyHttpStatus(401)).toBe("auth-failure");
		expect(classifyHttpStatus(403)).toBe("auth-failure");
	});

	it("maps 404 to not-found", () => {
		expect(classifyHttpStatus(404)).toBe("not-found");
	});

	it("maps everything else (429, 5xx) to transient", () => {
		expect(classifyHttpStatus(429)).toBe("transient");
		expect(classifyHttpStatus(500)).toBe("transient");
		expect(classifyHttpStatus(503)).toBe("transient");
	});
});

describe("requestWithRateLimitRetry", () => {
	it("returns the response as-is when it isn't a 429", async () => {
		const request: RequestFn = vi.fn().mockResolvedValue(response(200));
		const result = await requestWithRateLimitRetry(request, { url: "https://example.com" });
		expect(result.status).toBe(200);
		expect(request).toHaveBeenCalledTimes(1);
	});

	it("waits for Retry-After (capped) then retries exactly once on 429", async () => {
		const request: RequestFn = vi
			.fn()
			.mockResolvedValueOnce(response(429, { "retry-after": "5" }))
			.mockResolvedValueOnce(response(200));
		const sleep = vi.fn().mockResolvedValue(undefined);

		const result = await requestWithRateLimitRetry(request, { url: "https://example.com" }, { sleep });

		expect(sleep).toHaveBeenCalledWith(5000);
		expect(request).toHaveBeenCalledTimes(2);
		expect(result.status).toBe(200);
	});

	it("caps the wait at maxWaitSeconds even when Retry-After asks for longer", async () => {
		const request: RequestFn = vi
			.fn()
			.mockResolvedValueOnce(response(429, { "retry-after": "120" }))
			.mockResolvedValueOnce(response(200));
		const sleep = vi.fn().mockResolvedValue(undefined);

		await requestWithRateLimitRetry(request, { url: "https://example.com" }, { sleep, maxWaitSeconds: 30 });

		expect(sleep).toHaveBeenCalledWith(30_000);
	});

	it("gives up after one retry, even if still 429", async () => {
		const request: RequestFn = vi.fn().mockResolvedValue(response(429, { "retry-after": "1" }));
		const sleep = vi.fn().mockResolvedValue(undefined);

		const result = await requestWithRateLimitRetry(request, { url: "https://example.com" }, { sleep });

		expect(request).toHaveBeenCalledTimes(2);
		expect(result.status).toBe(429);
	});

	it("returns the 429 as-is when there's no Retry-After header to honor", async () => {
		const request: RequestFn = vi.fn().mockResolvedValue(response(429));
		const result = await requestWithRateLimitRetry(request, { url: "https://example.com" });
		expect(request).toHaveBeenCalledTimes(1);
		expect(result.status).toBe(429);
	});
});
