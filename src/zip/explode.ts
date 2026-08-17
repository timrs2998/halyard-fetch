/**
 * Zip explode and content-root detection. `fflate` is pure JS with no native
 * or WASM dependency, so this runs identically on desktop and mobile.
 */

import { unzipSync, type Unzipped } from "fflate";
import { normalizeVaultPath } from "../validation";

export function explodeZip(bytes: Uint8Array): Unzipped {
	return unzipSync(bytes);
}

export interface ContentRootDetection {
	/** Non-null only when there's exactly one top-level folder and no root-level files. */
	autoDetected: string | null;
	/** Every top-level folder name found, for the user to pick from when not auto-detected. */
	topLevelFolders: string[];
	/** True if the zip has any file sitting directly at its root (no wrapping folder). */
	hasRootLevelFiles: boolean;
}

/**
 * Inspects the top level of an exploded zip's entry paths, so a changed
 * upstream layout surfaces during setup rather than on a later scheduled
 * refresh. Exactly one top-level folder auto-fills `contentRootPath`; zero
 * or more than one makes the user pick.
 */
export function detectContentRoot(entryPaths: readonly string[]): ContentRootDetection {
	const topLevelFolders = new Set<string>();
	let hasRootLevelFiles = false;

	for (const raw of entryPaths) {
		let path = raw.replace(/^\/+/, "");
		const isDirMarker = path.endsWith("/");
		if (isDirMarker) path = path.slice(0, -1);
		if (path === "") continue;

		const slashIndex = path.indexOf("/");
		if (slashIndex === -1) {
			if (isDirMarker) {
				topLevelFolders.add(path);
			} else {
				hasRootLevelFiles = true;
			}
		} else {
			topLevelFolders.add(path.slice(0, slashIndex));
		}
	}

	const folders = Array.from(topLevelFolders).sort();
	const autoDetected = folders.length === 1 && !hasRootLevelFiles ? folders[0] : null;
	return { autoDetected, topLevelFolders: folders, hasRootLevelFiles };
}

/**
 * Returns file contents keyed by path relative to `contentRoot` (an empty
 * string means "the zip root itself" — the explicit choice for a zip with
 * no wrapping folder, see `detectContentRoot`). Directory-marker entries
 * (empty content, path ending in `/`) are dropped; they carry no content to
 * materialize.
 */
export function extractContentFiles(unzipped: Unzipped, contentRoot: string): Record<string, Uint8Array> {
	const normalizedRoot = normalizeVaultPath(contentRoot);
	const prefix = normalizedRoot === "" ? "" : normalizedRoot + "/";
	const result: Record<string, Uint8Array> = {};

	for (const [rawPath, data] of Object.entries(unzipped)) {
		const path = rawPath.replace(/^\/+/, "");
		if (path.endsWith("/")) continue;

		if (prefix === "") {
			result[path] = data;
			continue;
		}
		if (!path.startsWith(prefix)) continue;
		const relative = path.slice(prefix.length);
		if (relative === "") continue;
		result[relative] = data;
	}

	return result;
}

/**
 * Soft max-size guard, checked against the downloaded byte length before
 * extraction is attempted.
 */
export function exceedsSizeGuard(byteLength: number, maxSizeMB: number): boolean {
	return byteLength > maxSizeMB * 1024 * 1024;
}
