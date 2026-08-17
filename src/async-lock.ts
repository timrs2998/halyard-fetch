/** Serializes async work. */
export class AsyncLock {
	private tail: Promise<unknown> = Promise.resolve();

	run<T>(task: () => Promise<T>): Promise<T> {
		const result = this.tail.then(task, task);
		// Swallow rejections in the chain itself so one failed task doesn't
		// poison every later task queued behind it — callers still see the
		// real rejection via the returned promise.
		this.tail = result.then(
			() => undefined,
			() => undefined
		);
		return result;
	}
}

/**
 * One `AsyncLock` per key, created lazily. A scheduled tick, "Refresh now"
 * for a specific source, and "Refresh all sources now" all funnel through
 * the same per-source lock (keyed by `Source.id`) — but sources never lock
 * each other, since two sources share nothing (different hosts, tokens,
 * destinations) and there's no reason a slow source should stall a fast one.
 */
export class KeyedAsyncLock {
	private readonly locks = new Map<string, AsyncLock>();

	run<T>(key: string, task: () => Promise<T>): Promise<T> {
		let lock = this.locks.get(key);
		if (!lock) {
			lock = new AsyncLock();
			this.locks.set(key, lock);
		}
		return lock.run(task);
	}
}
