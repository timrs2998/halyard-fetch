import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { detectContentRoot, exceedsSizeGuard, explodeZip, extractContentFiles } from "../src/zip/explode";

/** Builds a real zip via fflate — flat keys so directory markers (trailing `/`) are explicit. */
function buildZip(entries: Record<string, string | null>): Uint8Array {
	const zippable: Record<string, Uint8Array> = {};
	for (const [path, content] of Object.entries(entries)) {
		zippable[path] = content === null ? new Uint8Array(0) : strToU8(content);
	}
	return zipSync(zippable);
}

describe("explodeZip against real zip fixtures", () => {
	it("round-trips a single-top-folder zip", () => {
		const zip = buildZip({
			"team-handbook/file.md": "hello",
			"team-handbook/sub/nested.md": "world",
		});
		const unzipped = explodeZip(zip);
		expect(strFromU8(unzipped["team-handbook/file.md"])).toBe("hello");
		expect(strFromU8(unzipped["team-handbook/sub/nested.md"])).toBe("world");
	});

	it("matches vanilla fflate unzipSync output", () => {
		const zip = buildZip({ "a.md": "1" });
		expect(explodeZip(zip)).toEqual(unzipSync(zip));
	});
});

describe("detectContentRoot", () => {
	it("auto-detects a single top-level folder", () => {
		const unzipped = explodeZip(
			buildZip({
				"team-handbook/file.md": "hello",
				"team-handbook/sub/nested.md": "world",
			})
		);
		const detection = detectContentRoot(Object.keys(unzipped));
		expect(detection.autoDetected).toBe("team-handbook");
		expect(detection.topLevelFolders).toEqual(["team-handbook"]);
		expect(detection.hasRootLevelFiles).toBe(false);
	});

	it("does not auto-detect a zero-top-folder zip (root-level files)", () => {
		const unzipped = explodeZip(buildZip({ "readme.md": "hi", "data.json": "{}" }));
		const detection = detectContentRoot(Object.keys(unzipped));
		expect(detection.autoDetected).toBeNull();
		expect(detection.topLevelFolders).toEqual([]);
		expect(detection.hasRootLevelFiles).toBe(true);
	});

	it("does not auto-detect a multi-top-folder zip", () => {
		const unzipped = explodeZip(buildZip({ "a/x.md": "1", "b/y.md": "2" }));
		const detection = detectContentRoot(Object.keys(unzipped));
		expect(detection.autoDetected).toBeNull();
		expect(detection.topLevelFolders).toEqual(["a", "b"]);
		expect(detection.hasRootLevelFiles).toBe(false);
	});

	it("auto-detects a single top-level folder even with a nested empty directory", () => {
		const unzipped = explodeZip(
			buildZip({
				"portal/file.md": "hi",
				"portal/empty/": null,
			})
		);
		const detection = detectContentRoot(Object.keys(unzipped));
		expect(detection.autoDetected).toBe("portal");
	});

	it("treats a lone top-level directory marker as a top-level folder, not a root-level file", () => {
		const unzipped = explodeZip(buildZip({ "portal/": null, "portal/file.md": "hi" }));
		const detection = detectContentRoot(Object.keys(unzipped));
		expect(detection.autoDetected).toBe("portal");
		expect(detection.hasRootLevelFiles).toBe(false);
	});
});

describe("extractContentFiles", () => {
	it("strips the content-root prefix and drops directory markers", () => {
		const unzipped = explodeZip(
			buildZip({
				"portal/file.md": "hi",
				"portal/sub/nested.md": "world",
				"portal/empty/": null,
			})
		);
		const files = extractContentFiles(unzipped, "portal");
		expect(Object.keys(files).sort()).toEqual(["file.md", "sub/nested.md"]);
		expect(strFromU8(files["file.md"])).toBe("hi");
		expect(strFromU8(files["sub/nested.md"])).toBe("world");
	});

	it("uses the zip root directly when contentRoot is empty", () => {
		const unzipped = explodeZip(buildZip({ "readme.md": "hi", "data.json": "{}" }));
		const files = extractContentFiles(unzipped, "");
		expect(Object.keys(files).sort()).toEqual(["data.json", "readme.md"]);
	});

	it("only includes files under the given content root, not siblings", () => {
		const unzipped = explodeZip(buildZip({ "a/x.md": "1", "b/y.md": "2" }));
		const files = extractContentFiles(unzipped, "a");
		expect(Object.keys(files)).toEqual(["x.md"]);
	});
});

describe("exceedsSizeGuard", () => {
	it("is false under the limit and true over it", () => {
		const oneMB = 1024 * 1024;
		expect(exceedsSizeGuard(10 * oneMB, 500)).toBe(false);
		expect(exceedsSizeGuard(501 * oneMB, 500)).toBe(true);
	});
});
