/**
 * Typed wrappers for vitest's asymmetric matchers.
 *
 * `expect.any()` / `expect.stringContaining()` are declared to return `any`, so
 * dropping one into an expected-object literal makes the whole literal
 * untyped — which is exactly the checking these `toEqual` assertions are
 * supposed to be doing. Wrapping them once, here, keeps the call sites honest:
 * an expected object still has to match the shape of what the code returns.
 */

import { expect } from "vitest";

/** Matches any string, typed as one so it fits a `string` field. */
export const anyString = (): string => expect.any(String) as string;

/** Matches any string containing `substring`. */
export const stringContaining = (substring: string): string =>
	expect.stringContaining(substring) as string;

/** Matches any number, typed as one so it fits a `number` field. */
export const anyNumber = (): number => expect.any(Number) as number;

/** Matches an object containing (at least) `subset`, typed as the whole. */
export const objectContaining = <T>(subset: Record<string, unknown>): T =>
	expect.objectContaining(subset) as T;
