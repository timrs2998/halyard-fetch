import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { KeyedAsyncLock } from "../src/async-lock";
import type { RequestFn } from "../src/fetchers/http";
import { formatBytes, refreshSource, type RefreshOrchestratorDeps, type TokenProvider } from "../src/refresh-orchestrator";
import { defaultSettings, type LogEntry, type Source, type SourceState } from "../src/types";
import { MockAdapter } from "./helpers/mock-adapter";
import { anyString } from "./helpers/matchers";
import { asMock } from "./helpers/mocks";

function buildZip(entries: Record<string, string | null>): Uint8Array {
	const zippable: Record<string, Uint8Array> = {};
	for (const [path, content] of Object.entries(entries)) {
		zippable[path] = content === null ? new Uint8Array(0) : strToU8(content);
	}
	return zipSync(zippable);
}

/** Defensive: a Uint8Array's `.buffer` can be larger than the view itself. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const source: Source = {
	id: "ledger-ab12cd",
	displayName: "Ledger",
	config: { kind: "gitlab-package", projectId: "1", packageName: "ledger", version: "latest", fileName: "ledger.zip" },
	destinationFolder: "Sources/Ledger",
	tokenRef: "ledger-ab12cd",
	refreshIntervalMinutes: 60,
	refreshOnForeground: true,
};

function response(status: number, headers: Record<string, string> = {}, arrayBuffer: ArrayBuffer = new ArrayBuffer(0)) {
	return { status, headers, arrayBuffer };
}

function harness(opts: { token?: string | null; initialState?: SourceState } = {}) {
	const adapter = new MockAdapter();
	const states: Record<string, SourceState> = { [source.id]: opts.initialState ?? {} };
	const logs: Record<string, LogEntry[]> = {};
	const notices: Array<{ source: Source; error: unknown }> = [];
	const tokenProvider: TokenProvider = { getToken: async () => (opts.token === undefined ? "tok" : opts.token) };

	const deps: RefreshOrchestratorDeps = {
		lock: new KeyedAsyncLock(),
		secretStore: tokenProvider,
		adapter,
		request: vi.fn<RequestFn>(),
		getSettings: () => defaultSettings(),
		getState: (id) => states[id] ?? {},
		setState: (id, state) => {
			states[id] = state;
		},
		appendLog: (id, entry) => {
			logs[id] = [...(logs[id] ?? []), entry];
		},
		showFailureNotice: (src, error) => {
			notices.push({ source: src, error });
		},
		now: () => 1_000_000,
	};

	return { deps, adapter, states, logs, notices };
}

describe("formatBytes", () => {
	it("formats bytes, KB, MB, GB", () => {
		expect(formatBytes(500)).toBe("500 B");
		expect(formatBytes(2048)).toBe("2.0 KB");
		expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
	});
});

describe("refreshSource", () => {
	it("fails with auth-failure when no token is configured, without making any request", async () => {
		const { deps, notices, logs } = harness({ token: null });
		const result = await refreshSource(source, "manual", deps);

		expect(result).toEqual({ ok: false, error: { kind: "auth-failure", message: anyString() } });
		expect(deps.request).not.toHaveBeenCalled();
		expect(notices).toHaveLength(1);
		expect(logs[source.id][0].outcome).toBe("auth-failure");
	});

	it("fails when the freshness check itself fails, without downloading", async () => {
		const { deps } = harness();
		(deps.request as ReturnType<typeof vi.fn>).mockResolvedValue(response(401));

		const result = await refreshSource(source, "manual", deps);

		expect(result).toEqual({ ok: false, error: { kind: "auth-failure", message: anyString() } });
		expect(deps.request).toHaveBeenCalledTimes(1);
	});

	it("skips the download and reports success when the freshness marker is unchanged", async () => {
		const { deps, states } = harness({ initialState: { lastSuccessAt: 0, lastFreshnessMarker: '"abc"::', lastBytesWritten: 42 } });
		(deps.request as ReturnType<typeof vi.fn>).mockResolvedValue(response(200, { etag: '"abc"' }));

		const result = await refreshSource(source, "interval", deps);

		expect(result).toEqual({ ok: true, skipped: true, freshnessMarker: '"abc"::' });
		expect(deps.request).toHaveBeenCalledTimes(1); // freshness check only, no GET
		expect(states[source.id].lastSuccessAt).toBe(1_000_000);
	});

	it("downloads, explodes, and materializes on a changed marker, auto-detecting the content root", async () => {
		const { deps, adapter, states, logs } = harness();
		const zip = buildZip({ "ledger/report.md": "hello", "ledger/sub/nested.md": "world" });
		(deps.request as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(response(200, { etag: '"new"' })) // HEAD freshness check
			.mockResolvedValueOnce(response(200, { etag: '"new"' }, toArrayBuffer(zip))); // GET download

		const result = await refreshSource(source, "manual", deps);

		expect(result.ok).toBe(true);
		expect(new TextDecoder().decode(adapter.files.get("Sources/Ledger/report.md"))).toBe("hello");
		expect(new TextDecoder().decode(adapter.files.get("Sources/Ledger/sub/nested.md"))).toBe("world");
		expect(states[source.id].lastOutcome).toBe("success");
		expect(logs[source.id][0].outcome).toBe("success");
	});

	it("uses an explicitly configured contentRootPath instead of auto-detecting", async () => {
		const { deps, adapter } = harness();
		const zip = buildZip({ "a/x.md": "1", "b/y.md": "2" });
		(deps.request as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(response(200, { etag: '"new"' }))
			.mockResolvedValueOnce(response(200, { etag: '"new"' }, toArrayBuffer(zip)));

		const result = await refreshSource({ ...source, contentRootPath: "a" }, "manual", deps);

		expect(result.ok).toBe(true);
		expect(adapter.files.has("Sources/Ledger/x.md")).toBe(true);
		expect(adapter.files.has("Sources/Ledger/y.md")).toBe(false);
	});

	it("fails with content-root-mismatch when auto-detection is ambiguous and no override is configured", async () => {
		const { deps, notices } = harness();
		const zip = buildZip({ "a/x.md": "1", "b/y.md": "2" });
		(deps.request as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(response(200, { etag: '"new"' }))
			.mockResolvedValueOnce(response(200, { etag: '"new"' }, toArrayBuffer(zip)));

		const result = await refreshSource(source, "manual", deps);

		expect(result).toEqual({ ok: false, error: { kind: "content-root-mismatch", message: anyString() } });
		expect(notices).toHaveLength(1);
	});

	it("fails with size-exceeded when the downloaded artifact is over the configured limit, without materializing", async () => {
		const { deps, adapter } = harness();
		const big = new Uint8Array(10);
		(deps.request as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(response(200, { etag: '"new"' }))
			.mockResolvedValueOnce(response(200, { etag: '"new"' }, toArrayBuffer(big)));

		const result = await refreshSource({ ...source, maxSizeMB: 0 }, "manual", deps);

		expect(result).toEqual({ ok: false, error: { kind: "size-exceeded", message: anyString() } });
		expect(adapter.files.size).toBe(0);
	});

	it("fails with materialize-failure when the adapter throws", async () => {
		const { deps, adapter } = harness();
		const zip = buildZip({ "ledger/report.md": "hello" });
		(deps.request as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(response(200, { etag: '"new"' }))
			.mockResolvedValueOnce(response(200, { etag: '"new"' }, toArrayBuffer(zip)));
		adapter.writeBinary = async () => {
			throw new Error("disk full");
		};

		const result = await refreshSource(source, "manual", deps);

		expect(result).toEqual({ ok: false, error: { kind: "materialize-failure", message: "disk full" } });
	});

	it("only fires the failure Notice once for repeated identical failures (dedup)", async () => {
		const { deps, notices } = harness({ token: null });
		await refreshSource(source, "manual", deps);
		await refreshSource(source, "manual", deps);
		expect(notices).toHaveLength(1);
	});

	it("serializes two concurrent refreshes of the same source through the per-source lock", async () => {
		const { deps } = harness();
		let concurrent = 0;
		let maxConcurrent = 0;
		asMock(deps.request).mockImplementation(async () => {
			concurrent++;
			maxConcurrent = Math.max(maxConcurrent, concurrent);
			await new Promise((r) => setTimeout(r, 5));
			concurrent--;
			return response(401);
		});

		await Promise.all([refreshSource(source, "manual", deps), refreshSource(source, "manual", deps)]);
		expect(maxConcurrent).toBe(1);
	});
});
