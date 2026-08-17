/**
 * Dispatches a `Source` to the fetcher matching its `config.kind`. Fetching
 * is the only stage that varies per source type; every source then funnels
 * into the same explode and materialize path.
 */

import type { Source } from "../types";
import * as githubRelease from "./github-release";
import * as gitlabPackage from "./gitlab-package";
import type { FetcherOutcome, RequestFn } from "./http";

export type { FetcherOutcome, RequestFn } from "./http";

export function checkFreshness(source: Source, token: string, request: RequestFn): Promise<FetcherOutcome<{ marker: string }>> {
	switch (source.config.kind) {
		case "gitlab-package":
			return gitlabPackage.gitlabCheckFreshness(source.config, token, request);
		case "github-release":
			return githubRelease.githubCheckFreshness(source.config, token, request);
	}
}

export function fetchZip(
	source: Source,
	token: string,
	request: RequestFn
): Promise<FetcherOutcome<{ bytes: Uint8Array; marker: string }>> {
	switch (source.config.kind) {
		case "gitlab-package":
			return gitlabPackage.gitlabFetchZip(source.config, token, request);
		case "github-release":
			return githubRelease.githubFetchZip(source.config, token, request);
	}
}
