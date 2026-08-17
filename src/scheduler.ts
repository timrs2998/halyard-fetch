/**
 * Scheduling decisions. Every trigger shares one staleness rule — has it
 * been at least `refreshIntervalMinutes` since the last success? — and
 * differs only in what may ask, and how connection-awareness applies:
 *
 * - `interval`: desktop's periodic timer tick. Mobile fires no equivalent,
 *   so only desktop produces this trigger. The staleness math is identical
 *   either way, which is what lets `refreshIntervalMinutes` mean "a timer"
 *   on desktop and "a staleness threshold" on mobile: the same number, asked
 *   by something different.
 * - `foreground`: a visibility or focus event, gated by the source's
 *   `refreshOnForeground` flag. Some sources want the interval cadence only.
 * - `launch`: the catch-up check run once from `onload`. Never flag-gated;
 *   it exists to cover "Obsidian was fully quit".
 * - `manual`: "Refresh now". Always runs, whatever the staleness or
 *   connection.
 */

import type { PluginSettings, Source, SourceState } from "./types";

export type RefreshTrigger = "interval" | "foreground" | "launch" | "manual";

export function isSourceDue(source: Source, state: SourceState, now: number): boolean {
	if (state.lastSuccessAt === undefined) return true;
	const intervalMs = source.refreshIntervalMinutes * 60 * 1000;
	return now - state.lastSuccessAt >= intervalMs;
}

/**
 * A per-source override wins; otherwise the global `mobileWifiOnly` setting
 * applies. `null` (the first-mobile-launch prompt hasn't run yet) resolves
 * to `true` — a safer default while the user hasn't been asked, matching
 * the "safer default for strangers" reasoning used elsewhere in the design
 * (e.g. the max-size guard's default). Desktop never calls this.
 */
export function resolveWifiOnly(source: Source, settings: PluginSettings): boolean {
	if (source.wifiOnlyOverride !== undefined) return source.wifiOnlyOverride;
	return settings.mobileWifiOnly ?? true;
}

export interface RefreshDecisionInput {
	source: Source;
	state: SourceState;
	settings: PluginSettings;
	now: number;
	isMobile: boolean;
	isOnCellular: boolean;
	trigger: RefreshTrigger;
}

export function shouldRefreshNow(input: RefreshDecisionInput): boolean {
	const { source, state, settings, now, isMobile, isOnCellular, trigger } = input;

	if (trigger === "manual") return true;
	if (trigger === "foreground" && !source.refreshOnForeground) return false;
	if (!isSourceDue(source, state, now)) return false;

	if (isMobile) {
		const wifiOnly = resolveWifiOnly(source, settings);
		if (wifiOnly && isOnCellular) return false;
	}

	return true;
}

export interface SchedulerCallbacks {
	now(): number;
	isMobile(): boolean;
	isOnCellular(): boolean;
	getSettings(): PluginSettings;
	getState(sourceId: string): SourceState;
	runRefresh(source: Source, trigger: RefreshTrigger): Promise<void>;
}

/**
 * Thin orchestration only — the actual fetch/explode/materialize pipeline
 * and its per-source concurrency lock live in `refresh-orchestrator.ts`
 * (`runRefresh` above is that orchestrator's entry point). Sources found
 * due on the same tick are refreshed concurrently, not sequentially — see
 * Sources never block each other: no reason a slow source should
 * stall a fast one.
 */
export class Scheduler {
	constructor(private readonly callbacks: SchedulerCallbacks) {}

	async tick(sources: readonly Source[], trigger: Exclude<RefreshTrigger, "manual">): Promise<void> {
		const now = this.callbacks.now();
		const isMobile = this.callbacks.isMobile();
		const isOnCellular = this.callbacks.isOnCellular();
		const settings = this.callbacks.getSettings();

		const due = sources.filter((source) =>
			shouldRefreshNow({
				source,
				state: this.callbacks.getState(source.id),
				settings,
				now,
				isMobile,
				isOnCellular,
				trigger,
			})
		);

		await Promise.all(due.map((source) => this.callbacks.runRefresh(source, trigger)));
	}
}
