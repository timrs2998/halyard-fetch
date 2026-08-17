import { describe, expect, it } from "vitest";
import { findOverlappingDestination, foldersOverlap, normalizeVaultPath } from "../src/validation";

describe("normalizeVaultPath", () => {
	it("converts backslashes and trims/collapses slashes", () => {
		expect(normalizeVaultPath("Sources\\Ledger\\")).toBe("Sources/Ledger");
		expect(normalizeVaultPath("/Sources//Ledger/")).toBe("Sources/Ledger");
	});
});

describe("foldersOverlap", () => {
	it("treats identical folders as overlapping", () => {
		expect(foldersOverlap("Sources/Ledger", "Sources/Ledger")).toBe(true);
	});

	it("treats a nested folder as overlapping in either direction", () => {
		expect(foldersOverlap("Sources/Ledger", "Sources/Ledger/Old")).toBe(true);
		expect(foldersOverlap("Sources/Ledger/Old", "Sources/Ledger")).toBe(true);
	});

	it("does not flag sibling folders with a shared prefix as overlapping", () => {
		expect(foldersOverlap("Sources/Ledger", "Sources/LedgerArchive")).toBe(false);
	});

	it("does not flag unrelated folders", () => {
		expect(foldersOverlap("Sources/Ledger", "Sources/Handbook")).toBe(false);
	});
});

describe("findOverlappingDestination", () => {
	const existing = [
		{ id: "a", destinationFolder: "Sources/Ledger" },
		{ id: "b", destinationFolder: "Sources/Handbook" },
	];

	it("returns the id of the conflicting source", () => {
		expect(findOverlappingDestination("Sources/Ledger/Nested", existing)).toBe("a");
	});

	it("returns null when there is no conflict", () => {
		expect(findOverlappingDestination("Sources/Other", existing)).toBeNull();
	});

	it("excludes the source's own id (for revalidating an edit)", () => {
		expect(findOverlappingDestination("Sources/Ledger", existing, "a")).toBeNull();
	});
});
