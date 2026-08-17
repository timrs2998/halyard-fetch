import { describe, expect, it } from "vitest";
import { AsyncLock, KeyedAsyncLock } from "../src/async-lock";

describe("AsyncLock", () => {
	it("runs a single task and returns its result", async () => {
		const lock = new AsyncLock();
		await expect(lock.run(async () => 42)).resolves.toBe(42);
	});

	it("serializes overlapping tasks in call order", async () => {
		const lock = new AsyncLock();
		const order: string[] = [];
		let releaseFirst: () => void = () => {};
		const firstGate = new Promise<void>((r) => (releaseFirst = r));

		const first = lock.run(async () => {
			order.push("first-start");
			await firstGate;
			order.push("first-end");
		});
		const second = lock.run(async () => {
			order.push("second-start");
			order.push("second-end");
		});

		await new Promise((r) => setTimeout(r, 0));
		expect(order).toEqual(["first-start"]);

		releaseFirst();
		await Promise.all([first, second]);
		expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"]);
	});

	it("releases the lock even when a task throws, so later tasks still run", async () => {
		const lock = new AsyncLock();
		await expect(
			lock.run(async () => {
				throw new Error("boom");
			})
		).rejects.toThrow("boom");

		await expect(lock.run(async () => "after failure")).resolves.toBe("after failure");
	});
});

describe("KeyedAsyncLock", () => {
	it("serializes tasks sharing the same key", async () => {
		const lock = new KeyedAsyncLock();
		const order: string[] = [];
		let releaseFirst: () => void = () => {};
		const gate = new Promise<void>((r) => (releaseFirst = r));

		const first = lock.run("source-a", async () => {
			order.push("a-start");
			await gate;
			order.push("a-end");
		});
		const second = lock.run("source-a", async () => {
			order.push("a2-start");
		});

		await new Promise((r) => setTimeout(r, 0));
		expect(order).toEqual(["a-start"]);
		releaseFirst();
		await Promise.all([first, second]);
		expect(order).toEqual(["a-start", "a-end", "a2-start"]);
	});

	it("does not serialize tasks under different keys", async () => {
		const lock = new KeyedAsyncLock();
		const order: string[] = [];
		let releaseA: () => void = () => {};
		const gateA = new Promise<void>((r) => (releaseA = r));

		const a = lock.run("source-a", async () => {
			order.push("a-start");
			await gateA;
			order.push("a-end");
		});
		const b = lock.run("source-b", async () => {
			order.push("b-start");
			order.push("b-end");
		});

		// b must be able to finish while a is still gated — a different source
		// should never stall behind a slow one.
		await b;
		expect(order).toEqual(["a-start", "b-start", "b-end"]);
		releaseA();
		await a;
		expect(order).toEqual(["a-start", "b-start", "b-end", "a-end"]);
	});
});
