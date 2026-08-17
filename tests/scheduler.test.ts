import { describe, expect, it, vi } from "vitest";
import { isSourceDue, resolveWifiOnly, Scheduler, shouldRefreshNow, type RefreshDecisionInput } from "../src/scheduler";
import { defaultSettings, type Source, type SourceState } from "../src/types";

function source(overrides: Partial<Source> = {}): Source {
	return {
		id: "s1",
		displayName: "Source",
		config: { kind: "gitlab-package", projectId: "1", packageName: "p", version: "latest", fileName: "p.zip" },
		destinationFolder: "Sources/S1",
		tokenRef: "s1",
		refreshIntervalMinutes: 60,
		refreshOnForeground: true,
		...overrides,
	};
}

const HOUR = 60 * 60 * 1000;

describe("isSourceDue", () => {
	it("is due when the interval has fully elapsed since the last success", () => {
		const state: SourceState = { lastSuccessAt: 0 };
		expect(isSourceDue(source({ refreshIntervalMinutes: 60 }), state, HOUR)).toBe(true);
	});

	it("is not due before the interval elapses", () => {
		const state: SourceState = { lastSuccessAt: 0 };
		expect(isSourceDue(source({ refreshIntervalMinutes: 60 }), state, HOUR - 1)).toBe(false);
	});

	it("treats a never-succeeded source (no lastSuccessAt) as immediately due", () => {
		expect(isSourceDue(source(), {}, 0)).toBe(true);
	});
});

describe("resolveWifiOnly", () => {
	it("uses the per-source override when set", () => {
		expect(resolveWifiOnly(source({ wifiOnlyOverride: false }), { ...defaultSettings(), mobileWifiOnly: true })).toBe(false);
		expect(resolveWifiOnly(source({ wifiOnlyOverride: true }), { ...defaultSettings(), mobileWifiOnly: false })).toBe(true);
	});

	it("falls back to the global setting when there's no override", () => {
		expect(resolveWifiOnly(source(), { ...defaultSettings(), mobileWifiOnly: false })).toBe(false);
	});

	it("defaults to true (safer) when the first-mobile-launch prompt hasn't run yet", () => {
		expect(resolveWifiOnly(source(), { ...defaultSettings(), mobileWifiOnly: null })).toBe(true);
	});
});

describe("shouldRefreshNow", () => {
	function input(overrides: Partial<RefreshDecisionInput> = {}): RefreshDecisionInput {
		return {
			source: source(),
			state: { lastSuccessAt: 0 },
			settings: defaultSettings(),
			now: HOUR,
			isMobile: false,
			isOnCellular: false,
			trigger: "interval",
			...overrides,
		};
	}

	it("manual always runs, even when not due and on cellular", () => {
		expect(
			shouldRefreshNow(input({ trigger: "manual", now: 0, isMobile: true, isOnCellular: true }))
		).toBe(true);
	});

	it("foreground trigger is skipped when refreshOnForeground is false, even if due", () => {
		expect(
			shouldRefreshNow(input({ trigger: "foreground", source: source({ refreshOnForeground: false }) }))
		).toBe(false);
	});

	it("foreground trigger runs when refreshOnForeground is true and due", () => {
		expect(shouldRefreshNow(input({ trigger: "foreground" }))).toBe(true);
	});

	it("launch trigger is never flag-gated, even if refreshOnForeground is false", () => {
		expect(
			shouldRefreshNow(input({ trigger: "launch", source: source({ refreshOnForeground: false }) }))
		).toBe(true);
	});

	it("interval trigger is skipped when not due", () => {
		expect(shouldRefreshNow(input({ trigger: "interval", now: 0 }))).toBe(false);
	});

	it("skips a due mobile source on cellular when Wi-Fi-only applies", () => {
		expect(
			shouldRefreshNow(
				input({ trigger: "launch", isMobile: true, isOnCellular: true, settings: { ...defaultSettings(), mobileWifiOnly: true } })
			)
		).toBe(false);
	});

	it("runs a due mobile source on cellular when Wi-Fi-only is off", () => {
		expect(
			shouldRefreshNow(
				input({ trigger: "launch", isMobile: true, isOnCellular: true, settings: { ...defaultSettings(), mobileWifiOnly: false } })
			)
		).toBe(true);
	});

	it("ignores cellular state entirely on desktop", () => {
		expect(
			shouldRefreshNow(
				input({ trigger: "launch", isMobile: false, isOnCellular: true, settings: { ...defaultSettings(), mobileWifiOnly: true } })
			)
		).toBe(true);
	});
});

describe("Scheduler", () => {
	it("refreshes only the due sources for the given trigger, concurrently", async () => {
		const due = source({ id: "due", refreshIntervalMinutes: 60 });
		const notDue = source({ id: "not-due", refreshIntervalMinutes: 24 * 60 });
		const states: Record<string, SourceState> = { due: { lastSuccessAt: 0 }, "not-due": { lastSuccessAt: HOUR } };

		const runRefresh = vi.fn().mockResolvedValue(undefined);
		const scheduler = new Scheduler({
			now: () => 2 * HOUR,
			isMobile: () => false,
			isOnCellular: () => false,
			getSettings: () => defaultSettings(),
			getState: (id) => states[id] ?? {},
			runRefresh,
		});

		await scheduler.tick([due, notDue], "interval");

		expect(runRefresh).toHaveBeenCalledTimes(1);
		expect(runRefresh).toHaveBeenCalledWith(due, "interval");
	});

	it("does not let one slow source's refresh delay another's from starting", async () => {
		const a = source({ id: "a" });
		const b = source({ id: "b" });
		const order: string[] = [];
		let releaseA: () => void = () => {};
		const gateA = new Promise<void>((resolve) => (releaseA = resolve));

		const scheduler = new Scheduler({
			now: () => HOUR,
			isMobile: () => false,
			isOnCellular: () => false,
			getSettings: () => defaultSettings(),
			getState: () => ({}),
			runRefresh: async (source) => {
				order.push(`${source.id}-start`);
				if (source.id === "a") await gateA;
				order.push(`${source.id}-end`);
			},
		});

		const tick = scheduler.tick([a, b], "launch");
		await new Promise((r) => setTimeout(r, 0));
		expect(order).toEqual(["a-start", "b-start", "b-end"]);
		releaseA();
		await tick;
		expect(order).toEqual(["a-start", "b-start", "b-end", "a-end"]);
	});
});
