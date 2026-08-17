import { describe, expect, it } from "vitest";
import { shouldFireFailureNotice } from "../src/notice-dedup";

describe("shouldFireFailureNotice", () => {
	it("fires on the very first attempt (no prior outcome)", () => {
		expect(shouldFireFailureNotice(undefined, "auth-failure")).toBe(true);
	});

	it("fires on the transition from success to failure", () => {
		expect(shouldFireFailureNotice("success", "transient")).toBe(true);
	});

	it("fires when the error kind changes from the last failure", () => {
		expect(shouldFireFailureNotice("transient", "auth-failure")).toBe(true);
	});

	it("does not fire on a repeated identical failure", () => {
		expect(shouldFireFailureNotice("auth-failure", "auth-failure")).toBe(false);
	});
});
