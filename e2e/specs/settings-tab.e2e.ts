/**
 * The settings tab is declared, not rendered, by this plugin: it returns
 * `getSettingDefinitions()` and Obsidian builds the DOM (1.13+). A malformed
 * definition — a control bound to a missing key, a list whose items the
 * framework rejects — fails at *render* time inside a real app, where no unit
 * test can see it. These specs open the real tab and check the rows came out.
 */

import { browser, expect } from "@wdio/globals";
import { describe, it } from "mocha";

/** Opens the app's settings modal on this plugin's tab, and waits for a paint. */
async function openSettingsTab(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		const setting = (
			app as unknown as { setting: { open(): void; openTabById(id: string): void } }
		).setting;
		setting.open();
		setting.openTabById("halyard-fetch");
	});
	await browser.waitUntil(
		async () => (await settingNames()).includes("Restrict scheduled refreshes to Wi-Fi"),
		{ timeout: 10_000, timeoutMsg: "Halyard Fetch's settings tab did not render its rows" }
	);
}

/**
 * Every setting row's name in the *active* tab. Scoped to the tab's own
 * container: the settings modal keeps other tabs' rows around, so a
 * document-wide query happily reads a core plugin's settings instead.
 */
function settingNames(): Promise<string[]> {
	return browser.executeObsidian(({ app }) => {
		const container = (app as unknown as { setting: { activeTab?: { containerEl?: HTMLElement } } })
			.setting.activeTab?.containerEl;
		if (!container?.isConnected) return [];
		return Array.from(container.querySelectorAll(".setting-item-name")).map(
			(el) => el.textContent?.trim() ?? ""
		);
	});
}

describe("Halyard Fetch's settings tab", function () {
	afterEach(async function () {
		await browser.executeObsidian(({ app }) => {
			(app as unknown as { setting: { close(): void } }).setting.close();
		});
	});

	it("renders its declarative definitions", async function () {
		await openSettingsTab();
		const names = await settingNames();

		expect(names).toContain("Restrict scheduled refreshes to Wi-Fi");
		expect(names).toContain("Default max artifact size (MB)");
	});

	it("renders the Sources list and its section headings", async function () {
		await openSettingsTab();
		const headings = await browser.executeObsidian(({ app }) => {
			const container = (app as unknown as { setting: { activeTab?: { containerEl?: HTMLElement } } })
				.setting.activeTab?.containerEl;
			return Array.from(
				container?.querySelectorAll(".setting-group-heading, .setting-item-heading") ?? []
			).map((el) => el.textContent?.trim() ?? "");
		});

		expect(headings).toContain("Sources");
		expect(headings).toContain("Mobile");
		expect(headings).toContain("Defaults");
	});

	it("shows the list's empty state when no source is configured", async function () {
		await openSettingsTab();
		const text = await browser.executeObsidian(({ app }) => {
			const container = (app as unknown as { setting: { activeTab?: { containerEl?: HTMLElement } } })
				.setting.activeTab?.containerEl;
			return container?.textContent ?? "";
		});
		expect(text).toContain("No sources configured.");
	});

	it("binds controls to stored settings, both directions", async function () {
		await openSettingsTab();

		const stored = await browser.executeObsidian(async ({ app }) => {
			const plugin = (
				app as unknown as {
					plugins: { plugins: Record<string, { settings: Record<string, unknown> }> };
				}
			).plugins.plugins["halyard-fetch"];
			const tab = (
				app as unknown as {
					setting: {
						activeTab?: {
							setControlValue(key: string, value: unknown): void | Promise<void>;
							getControlValue(key: string): unknown;
						};
					};
				}
			).setting.activeTab;
			await tab?.setControlValue("defaultMaxSizeMB", 42);
			return {
				persisted: plugin.settings.defaultMaxSizeMB,
				readBack: tab?.getControlValue("defaultMaxSizeMB"),
				// Tri-state: stored as null/boolean, shown as a string.
				wifi: tab?.getControlValue("mobileWifiOnly"),
			};
		});

		expect(stored.persisted).toBe(42);
		expect(stored.readBack).toBe(42);
		expect(stored.wifi).toBe("unset");
	});

	it("exposes its settings to Obsidian's settings search", async function () {
		await openSettingsTab();
		const indexed = await browser.executeObsidian(({ app }) => {
			const tab = (app as unknown as { setting: { activeTab?: { settingItems?: unknown[] } } })
				.setting.activeTab;
			return Array.isArray(tab?.settingItems) ? tab.settingItems.length : 0;
		});
		expect(indexed).toBeGreaterThan(0);
	});
});
