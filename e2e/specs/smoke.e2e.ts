import { browser, expect } from "@wdio/globals";
import { describe, it } from "mocha";
import { obsidianPage } from "wdio-obsidian-service";

describe("Tether Fetch loads in a real Obsidian instance", function () {
	afterEach(async function () {
		await obsidianPage.resetVault("e2e/vaults/simple");
	});

	it("registers its commands", async function () {
		const commandIds = await browser.executeObsidian(({ app }) => {
			return Object.keys((app as unknown as { commands: { commands: Record<string, unknown> } }).commands.commands);
		});
		expect(commandIds).toContain("tether-fetch:refresh-all");
		expect(commandIds).toContain("tether-fetch:add-source");
		expect(commandIds).toContain("tether-fetch:open-log");
	});

	it("adds a ribbon icon", async function () {
		const ribbon = browser.$('.side-dock-ribbon-action[aria-label="Tether Fetch: refresh all sources"]');
		await expect(ribbon).toExist();
	});

	it("shows a zero-sources status bar item", async function () {
		// Obsidian's mobile UI doesn't render the desktop status-bar strip at
		// all, so WDIO's visibility-based getText()/toHaveText() sees "" there
		// even though the plugin set it correctly — read textContent directly
		// instead of depending on Obsidian's own chrome choices per platform.
		const text = await browser.executeObsidian(() => {
			return document.querySelector(".tether-fetch-status-bar")?.textContent ?? null;
		});
		expect(text).toEqual("Tether Fetch: no sources");
	});

	it("opens the add-source wizard from the command palette", async function () {
		await browser.executeObsidianCommand("tether-fetch:add-source");

		const heading = browser.$(".modal-container .modal-content h2");
		await expect(heading).toExist();
		await expect(heading).toHaveText(/^Add source/);
	});
});
