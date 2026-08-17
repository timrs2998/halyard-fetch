/**
 * Mirror-semantics materialize: copy in added and changed files, delete
 * files no longer present upstream. Written directly against
 * `app.vault.adapter` rather than shelling out to a copy tool, since mobile
 * has no subprocess.
 */

import { normalizeVaultPath } from "./validation";
import type { VaultAdapterLike } from "./vault-adapter";

/** Pure: given what's on disk vs. what the new zip contains, which existing files are now orphans. */
export function computeMirrorPlan(
	existingRelativePaths: readonly string[],
	newRelativePaths: readonly string[]
): { toDelete: string[] } {
	const keep = new Set(newRelativePaths);
	return { toDelete: existingRelativePaths.filter((path) => !keep.has(path)) };
}

async function listAllFiles(adapter: VaultAdapterLike, folder: string): Promise<string[]> {
	if (!(await adapter.exists(folder))) return [];
	const result: string[] = [];
	async function walk(path: string): Promise<void> {
		const { files, folders } = await adapter.list(path);
		result.push(...files);
		for (const sub of folders) await walk(sub);
	}
	await walk(folder);
	return result;
}

async function ensureParentDirs(adapter: VaultAdapterLike, filePath: string): Promise<void> {
	const parts = filePath.split("/");
	parts.pop();
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!(await adapter.exists(current))) {
			await adapter.mkdir(current);
		}
	}
}

/** Removes now-empty folders left behind by deletions, bottom-up. Never removes `root` itself. */
async function pruneEmptyDirectories(adapter: VaultAdapterLike, root: string): Promise<void> {
	async function walk(path: string): Promise<boolean> {
		const { files, folders } = await adapter.list(path);
		let allSubfoldersEmpty = true;
		for (const sub of folders) {
			const subEmpty = await walk(sub);
			if (!subEmpty) allSubfoldersEmpty = false;
		}
		const isEmpty = files.length === 0 && allSubfoldersEmpty;
		if (isEmpty && path !== root) {
			await adapter.rmdir(path, false);
		}
		return isEmpty;
	}
	if (await adapter.exists(root)) {
		await walk(root);
	}
}

export interface MaterializeResult {
	bytesWritten: number;
	filesWritten: number;
	filesDeleted: number;
}

/**
 * Writes every file in `newFiles` (relative paths -> bytes) under
 * `destinationFolder`, deletes whatever was there before that's no longer
 * present, and prunes any folders that leaves empty. Unconditionally
 * overwrites everything in `newFiles` rather than diffing content first.
 * Rewriting an unchanged file is harmless, and the destination folder is
 * always overwritten wholesale anyway.
 */
export async function materialize(
	adapter: VaultAdapterLike,
	destinationFolder: string,
	newFiles: Readonly<Record<string, Uint8Array>>
): Promise<MaterializeResult> {
	const root = normalizeVaultPath(destinationFolder);
	if (!(await adapter.exists(root))) {
		await adapter.mkdir(root);
	}

	const existingFullPaths = await listAllFiles(adapter, root);
	const existingRelative = existingFullPaths.map((path) => path.slice(root.length + 1));
	const newRelativePaths = Object.keys(newFiles);
	const { toDelete } = computeMirrorPlan(existingRelative, newRelativePaths);

	let bytesWritten = 0;
	for (const [relativePath, data] of Object.entries(newFiles)) {
		const fullPath = `${root}/${relativePath}`;
		await ensureParentDirs(adapter, fullPath);
		const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
		await adapter.writeBinary(fullPath, buffer);
		bytesWritten += data.byteLength;
	}

	for (const relativePath of toDelete) {
		await adapter.remove(`${root}/${relativePath}`);
	}

	await pruneEmptyDirectories(adapter, root);

	return { bytesWritten, filesWritten: newRelativePaths.length, filesDeleted: toDelete.length };
}
