import { describe, expect, it } from "vitest";
import { generateSourceId, slugify } from "../src/id";

describe("slugify", () => {
	it("lowercases and hyphenates", () => {
		expect(slugify("Team Handbook")).toBe("team-handbook");
	});

	it("strips punctuation and collapses runs of separators", () => {
		expect(slugify("Ledger (GitLab) -- v2!!")).toBe("ledger-gitlab-v2");
	});

	it("trims leading/trailing hyphens", () => {
		expect(slugify("  --hello--  ")).toBe("hello");
	});

	it("falls back to a placeholder for an empty/unslugifiable name", () => {
		expect(slugify("")).toBe("source");
		expect(slugify("!!!")).toBe("source");
	});
});

describe("generateSourceId", () => {
	it("prefixes the slug and appends a random suffix", () => {
		const id = generateSourceId("Team Handbook");
		expect(id).toMatch(/^team-handbook-[a-z0-9]{6}$/);
	});

	it("generates distinct ids for the same display name", () => {
		const a = generateSourceId("Ledger");
		const b = generateSourceId("Ledger");
		expect(a).not.toBe(b);
	});
});
