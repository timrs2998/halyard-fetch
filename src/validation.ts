/**
 * Destination-folder-overlap validation. Because materialize deletes orphans
 * (see `materialize.ts`), two sources sharing or nesting inside one
 * destination corrupt each other: every refresh deletes the other source's
 * files as "no longer present upstream". This is a data risk, not a cosmetic
 * conflict.
 */

export function normalizeVaultPath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/+|\/+$/g, "");
}

/** True if `a` and `b` are the same folder, or one nests inside the other. */
export function foldersOverlap(a: string, b: string): boolean {
	const na = normalizeVaultPath(a);
	const nb = normalizeVaultPath(b);
	if (na === nb) return true;
	return na.startsWith(nb + "/") || nb.startsWith(na + "/");
}

/**
 * Returns the id of the first existing source whose destination overlaps
 * `candidate`, or `null` if there's no conflict. `excludeId` lets an edit
 * revalidate against everyone *else* without flagging itself.
 */
export function findOverlappingDestination(
	candidate: string,
	existing: readonly { id: string; destinationFolder: string }[],
	excludeId?: string
): string | null {
	for (const source of existing) {
		if (source.id === excludeId) continue;
		if (foldersOverlap(candidate, source.destinationFolder)) return source.id;
	}
	return null;
}
