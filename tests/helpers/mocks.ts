/**
 * Typed accessors for vitest mocks.
 *
 * `vi.fn()`'s recorded calls come back as `any[]`, so reading an argument off
 * `mock.calls` silently drops out of type checking. These wrappers keep the
 * argument types the mocked function declares.
 */

import type { Mock } from "vitest";
import type { HttpRequestOptions, RequestFn } from "../../src/fetchers/http";

/** The mock behind a function-typed dependency, for `mockImplementation` and friends. */
export function asMock<Args extends unknown[], Return>(
	fn: (...args: Args) => Return
): Mock<(...args: Args) => Return> {
	return fn as Mock<(...args: Args) => Return>;
}

/** Every recorded call's arguments, typed as `RequestFn` declares them. */
export function requestCalls(request: RequestFn): [HttpRequestOptions][] {
	return asMock(request).mock.calls;
}
