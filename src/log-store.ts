/**
 * Backing store for the in-app log viewer. Retention is capped at the last
 * 50 attempts per source or 30 days, whichever is smaller, so `data.json`
 * can't grow unboundedly. Pure functions over plain objects, immutable in
 * and out, so the persistence layer treats each result as the next
 * `data.json` shape and nothing here depends on Obsidian.
 */

import type { LogEntry } from "./types";

const DEFAULT_MAX_ENTRIES = 50;
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface RetentionOptions {
	maxEntries?: number;
	maxAgeMs?: number;
	now?: number;
}

/** Appends `entry`, then applies both caps as an intersection (age filter, then a count cap on what's left). */
export function appendLogEntry(existing: readonly LogEntry[], entry: LogEntry, options: RetentionOptions = {}): LogEntry[] {
	const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
	const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
	const now = options.now ?? Date.now();

	const withinAge = [...existing, entry].filter((e) => now - e.timestamp <= maxAgeMs);
	return withinAge.slice(Math.max(0, withinAge.length - maxEntries));
}

export function withLogEntry(
	logs: Readonly<Record<string, readonly LogEntry[]>>,
	sourceId: string,
	entry: LogEntry,
	options: RetentionOptions = {}
): Record<string, LogEntry[]> {
	const existing = logs[sourceId] ?? [];
	const result: Record<string, LogEntry[]> = {};
	for (const [id, entries] of Object.entries(logs)) {
		result[id] = [...entries];
	}
	result[sourceId] = appendLogEntry(existing, entry, options);
	return result;
}

/** Used when a source is removed. */
export function withoutSource(logs: Readonly<Record<string, readonly LogEntry[]>>, sourceId: string): Record<string, LogEntry[]> {
	const rest: Record<string, LogEntry[]> = {};
	for (const [id, entries] of Object.entries(logs)) {
		if (id !== sourceId) rest[id] = [...entries];
	}
	return rest;
}
