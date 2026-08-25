/** The shared Halyard block-and-rope silhouette. The attached artifact and
 * downward chevron distinguish one-way fetches from Halyard Sync's opposed
 * rope travel. */

import { addIcon } from "obsidian";

export const HALYARD_FETCH_ICON_ID = "halyard-fetch";

export function registerHalyardFetchIcon(): void {
	addIcon(
		HALYARD_FETCH_ICON_ID,
		`<circle cx="50" cy="21" r="10.5" fill="none" stroke="currentColor" stroke-width="8"/>` +
			`<path d="M39.5 30 C 32 33, 27 40, 27 48 V 67 M60.5 30 C 68 33, 73 40, 73 48 V 79" ` +
			`fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>` +
			`<rect x="17" y="67" width="20" height="20" rx="4" fill="none" stroke="currentColor" ` +
			`stroke-width="8"/>` +
			`<path d="M63 69 L73 79 L83 69" fill="none" stroke="currentColor" stroke-width="8" ` +
			`stroke-linecap="round" stroke-linejoin="round"/>`
	);
}
