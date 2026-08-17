import { describe, expect, it } from "vitest";
import { computeMirrorPlan, materialize } from "../src/materialize";
import { MockAdapter } from "./helpers/mock-adapter";

function u8(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

describe("computeMirrorPlan", () => {
	it("flags existing paths absent from the new set as orphans", () => {
		const plan = computeMirrorPlan(["a.md", "b.md", "sub/c.md"], ["a.md", "sub/c.md"]);
		expect(plan.toDelete).toEqual(["b.md"]);
	});

	it("flags nothing when every existing path is still present", () => {
		const plan = computeMirrorPlan(["a.md"], ["a.md", "b.md"]);
		expect(plan.toDelete).toEqual([]);
	});
});

describe("materialize", () => {
	it("creates the destination folder and writes every file on a fresh sync", async () => {
		const adapter = new MockAdapter();
		const result = await materialize(adapter, "Sources/Ledger", {
			"readme.md": u8("hello"),
			"sub/nested.md": u8("world"),
		});

		expect(result).toEqual({ bytesWritten: 10, filesWritten: 2, filesDeleted: 0 });
		expect(new TextDecoder().decode(adapter.files.get("Sources/Ledger/readme.md"))).toBe("hello");
		expect(new TextDecoder().decode(adapter.files.get("Sources/Ledger/sub/nested.md"))).toBe("world");
		expect(adapter.folders.has("Sources/Ledger/sub")).toBe(true);
	});

	it("deletes orphaned files no longer present upstream", async () => {
		const adapter = new MockAdapter();
		await materialize(adapter, "Sources/Ledger", { "old.md": u8("stale") });
		const result = await materialize(adapter, "Sources/Ledger", { "new.md": u8("fresh") });

		expect(result.filesDeleted).toBe(1);
		expect(adapter.files.has("Sources/Ledger/old.md")).toBe(false);
		expect(adapter.files.has("Sources/Ledger/new.md")).toBe(true);
	});

	it("prunes folders left empty by deletion but keeps the destination root", async () => {
		const adapter = new MockAdapter();
		await materialize(adapter, "Sources/Ledger", { "sub/old.md": u8("stale") });
		await materialize(adapter, "Sources/Ledger", { "new.md": u8("fresh") });

		expect(adapter.folders.has("Sources/Ledger/sub")).toBe(false);
		expect(adapter.folders.has("Sources/Ledger")).toBe(true);
	});

	it("overwrites a changed file in place", async () => {
		const adapter = new MockAdapter();
		await materialize(adapter, "Sources/Ledger", { "readme.md": u8("v1") });
		await materialize(adapter, "Sources/Ledger", { "readme.md": u8("v2") });

		expect(new TextDecoder().decode(adapter.files.get("Sources/Ledger/readme.md"))).toBe("v2");
	});

	it("correctly writes a Uint8Array view with a non-zero byte offset", async () => {
		// Simulates fflate's output, which hands back subarrays of a shared buffer.
		const shared = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
		const view = shared.subarray(2, 5); // [1, 2, 3]

		const adapter = new MockAdapter();
		await materialize(adapter, "Sources/Ledger", { "data.bin": view });

		expect(Array.from(adapter.files.get("Sources/Ledger/data.bin")!)).toEqual([1, 2, 3]);
	});

	it("leaves an empty destination root in place even with zero new files", async () => {
		const adapter = new MockAdapter();
		await materialize(adapter, "Sources/Ledger", { "old.md": u8("stale") });
		const result = await materialize(adapter, "Sources/Ledger", {});

		expect(result).toEqual({ bytesWritten: 0, filesWritten: 0, filesDeleted: 1 });
		expect(adapter.folders.has("Sources/Ledger")).toBe(true);
	});
});
