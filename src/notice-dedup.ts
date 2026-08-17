import type { RefreshErrorKind, RefreshOutcome } from "./types";

/**
 * Fires a Notice on a *transition* only: the first failure after a success,
 * or a failure whose error kind differs from the one before it. Repeating
 * the same failure stays silent — otherwise an expired token left unattended
 * would fire an identical Notice on every scheduled attempt.
 */
export function shouldFireFailureNotice(
	previousOutcome: RefreshOutcome | undefined,
	currentErrorKind: RefreshErrorKind
): boolean {
	if (previousOutcome === undefined) return true;
	if (previousOutcome === "success") return true;
	return previousOutcome !== currentErrorKind;
}
