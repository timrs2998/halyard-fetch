import { describe, expect, it } from "vitest";
import { appendLogEntry, withLogEntry, withoutSource } from "../src/log-store";
import type { LogEntry } from "../src/types";

function entry(timestamp: number, outcome: LogEntry["outcome"] = "success"): LogEntry {
	return { timestamp, outcome, detail: "" };
}

describe("appendLogEntry", () => {
	it("appends to an empty history", () => {
		const result = appendLogEntry([], entry(1000), { now: 1000 });
		expect(result).toEqual([entry(1000)]);
	});

	it("caps to maxEntries, dropping the oldest first", () => {
		const existing = [entry(1), entry(2), entry(3)];
		const result = appendLogEntry(existing, entry(4), { maxEntries: 3, now: 4 });
		expect(result.map((e) => e.timestamp)).toEqual([2, 3, 4]);
	});

	it("drops entries older than maxAgeMs relative to now", () => {
		const dayMs = 24 * 60 * 60 * 1000;
		const existing = [entry(0), entry(20 * dayMs)];
		const result = appendLogEntry(existing, entry(31 * dayMs), { maxAgeMs: 30 * dayMs, now: 31 * dayMs });
		expect(result.map((e) => e.timestamp)).toEqual([20 * dayMs, 31 * dayMs]);
	});

	it("applies both caps together (age filter, then count cap on what's left)", () => {
		const existing = [entry(1), entry(2), entry(3), entry(4)];
		const result = appendLogEntry(existing, entry(5), { maxEntries: 2, maxAgeMs: 1000, now: 5 });
		expect(result.map((e) => e.timestamp)).toEqual([4, 5]);
	});
});

describe("withLogEntry", () => {
	it("creates a new per-source array without mutating the input map", () => {
		const logs = { a: [entry(1)] };
		const result = withLogEntry(logs, "b", entry(2), { now: 2 });
		expect(logs).toEqual({ a: [entry(1)] });
		expect(result).toEqual({ a: [entry(1)], b: [entry(2)] });
	});

	it("appends to an existing source's history", () => {
		const logs = { a: [entry(1)] };
		const result = withLogEntry(logs, "a", entry(2), { now: 2 });
		expect(result.a.map((e) => e.timestamp)).toEqual([1, 2]);
	});
});

describe("withoutSource", () => {
	it("removes only the given source's history", () => {
		const logs = { a: [entry(1)], b: [entry(2)] };
		expect(withoutSource(logs, "a")).toEqual({ b: [entry(2)] });
	});

	it("is a no-op when the source has no history", () => {
		const logs = { a: [entry(1)] };
		expect(withoutSource(logs, "missing")).toEqual({ a: [entry(1)] });
	});
});
