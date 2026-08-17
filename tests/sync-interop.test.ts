import { describe, expect, it, vi } from "vitest";
import { detectTetherSync, folderIgnorePattern } from "../src/sync-interop";

describe("detectTetherSync", () => {
	it("returns null when Tether Sync isn't installed", () => {
		expect(detectTetherSync({ plugins: { plugins: {} } })).toBeNull();
		expect(detectTetherSync({ plugins: {} })).toBeNull();
		expect(detectTetherSync({})).toBeNull();
		expect(detectTetherSync(null)).toBeNull();
	});

	it("returns null when a plugin at that id exists but lacks the method (older Tether Sync)", () => {
		expect(detectTetherSync({ plugins: { plugins: { "tether-sync": {} } } })).toBeNull();
		expect(detectTetherSync({ plugins: { plugins: { "tether-sync": { registerExternalIgnorePattern: "nope" } } } })).toBeNull();
	});

	it("returns a callable registrar when Tether Sync exposes the method", async () => {
		const registerExternalIgnorePattern = vi.fn().mockResolvedValue(true);
		const registrar = detectTetherSync({
			plugins: { plugins: { "tether-sync": { registerExternalIgnorePattern } } },
		});
		expect(registrar).not.toBeNull();
		await expect(registrar!.registerExternalIgnorePattern("Sources/Ledger/")).resolves.toBe(true);
		expect(registerExternalIgnorePattern).toHaveBeenCalledWith("Sources/Ledger/");
	});
});

describe("folderIgnorePattern", () => {
	it("appends a trailing slash so Tether Sync's matcher covers the whole folder", () => {
		expect(folderIgnorePattern("Sources/Ledger")).toBe("Sources/Ledger/");
	});

	it("leaves an already-slash-terminated path alone", () => {
		expect(folderIgnorePattern("Sources/Ledger/")).toBe("Sources/Ledger/");
	});
});
