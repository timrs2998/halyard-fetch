/**
 * The real `RequestFn` implementation, backed by Obsidian's `requestUrl`
 * (CORS-free, works on desktop and mobile). Glue only, kept out of `http.ts`
 * so every fetcher stays testable against a fake `RequestFn`.
 */

import { requestUrl } from "obsidian";
import type { HttpRequestOptions, HttpResponse, RequestFn } from "./http";

export const obsidianRequest: RequestFn = async (opts: HttpRequestOptions): Promise<HttpResponse> => {
	const response = await requestUrl({
		url: opts.url,
		method: opts.method ?? "GET",
		headers: opts.headers,
		throw: false,
	});

	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(response.headers ?? {})) {
		headers[key.toLowerCase()] = value;
	}

	return { status: response.status, headers, arrayBuffer: response.arrayBuffer };
};
