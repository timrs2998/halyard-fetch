import { describe, expect, it, vi } from "vitest";
import { detectHalyardSync, folderIgnorePattern } from "../src/sync-interop";

describe("detectHalyardSync", () => {
	it("returns null when Halyard Sync isn't installed", () => {
		expect(detectHalyardSync({ plugins: { plugins: {} } })).toBeNull();
		expect(detectHalyardSync({ plugins: {} })).toBeNull();
		expect(detectHalyardSync({})).toBeNull();
		expect(detectHalyardSync(null)).toBeNull();
	});

	it("returns null when a plugin at that id exists but lacks the method (older Halyard Sync)", () => {
		expect(detectHalyardSync({ plugins: { plugins: { "halyard-sync": {} } } })).toBeNull();
		expect(detectHalyardSync({ plugins: { plugins: { "halyard-sync": { registerExternalIgnorePattern: "nope" } } } })).toBeNull();
	});

	it("returns a callable registrar when Halyard Sync exposes the method", async () => {
		const registerExternalIgnorePattern = vi.fn().mockResolvedValue(true);
		const registrar = detectHalyardSync({
			plugins: { plugins: { "halyard-sync": { registerExternalIgnorePattern } } },
		});
		expect(registrar).not.toBeNull();
		await expect(registrar!.registerExternalIgnorePattern("Sources/Ledger/")).resolves.toBe(true);
		expect(registerExternalIgnorePattern).toHaveBeenCalledWith("Sources/Ledger/");
	});
});

describe("folderIgnorePattern", () => {
	it("appends a trailing slash so Halyard Sync's matcher covers the whole folder", () => {
		expect(folderIgnorePattern("Sources/Ledger")).toBe("Sources/Ledger/");
	});

	it("leaves an already-slash-terminated path alone", () => {
		expect(folderIgnorePattern("Sources/Ledger/")).toBe("Sources/Ledger/");
	});
});
