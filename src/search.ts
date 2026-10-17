import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runDdgrSearch } from "./providers/ddgr/index.ts";
import { runDeepSeekSearch } from "./providers/deepseek/index.ts";
import {
    PI_WEB_CONFIG_FILE,
    PI_WEB_PROVIDER_ENV,
    readPiWebConfig,
    resolveSearchProvider,
    type EmptyStreak,
    type PiWebConfig,
} from "./search-provider.ts";
import {
    DEFAULT_NOTIFY_AFTER_EMPTY_RESULTS,
    DEFAULT_SEARCH_MAX_RESULTS,
    DEFAULT_SEARCH_TIMEOUT_MS,
    MAX_SEARCH_RESULTS,
    MAX_SEARCH_TIMEOUT_MS,
    SEARCH_PROVIDERS,
    type NormalizedWebSearchInput,
    type ToolRunResult,
    type WebSearchDetails,
    type WebSearchInput,
    type WebSearchProvider,
    type WebSearchTimeRange,
} from "./types.ts";

const TIME_RANGES = new Set<WebSearchTimeRange>(["d", "w", "m", "y"]);

export interface RunWebSearchDeps {
    config?: PiWebConfig;
    env?: NodeJS.ProcessEnv;
    streak?: EmptyStreak;
    fetchImpl?: typeof fetch;
}

function normalizeInteger(value: unknown, fallback: number, max: number, name: string): number {
    if (value === undefined || value === null) return fallback;
    if (!Number.isInteger(value) || Number(value) < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
    if (Number(value) > max) {
        throw new Error(`${name} must be <= ${max}`);
    }
    return Number(value);
}

function normalizeOptionalToken(value: unknown, name: string): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") throw new Error(`${name} must be a string`);
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/\s/.test(trimmed)) throw new Error(`${name} must not contain whitespace`);
    if (trimmed.length > 120) throw new Error(`${name} is too long`);
    return trimmed;
}

function normalizeRegion(value: unknown): string | undefined {
    const region = normalizeOptionalToken(value, "region");
    if (region === undefined) return undefined;
    if (!/^[a-zA-Z0-9_-]+$/.test(region)) {
        throw new Error("region may only contain letters, numbers, underscores, and hyphens");
    }
    return region;
}

export function normalizeSearchInput(input: WebSearchInput): NormalizedWebSearchInput {
    if (!input || typeof input !== "object") throw new Error("web_search input must be an object");
    if (typeof input.query !== "string" || !input.query.trim()) {
        throw new Error("query must be a non-empty string");
    }

    const query = input.query.trim();
    if (query.startsWith("!")) {
        throw new Error("DuckDuckGo bang queries are disabled for web_search; remove the leading !");
    }

    const timeRange = input.timeRange;
    if (timeRange !== undefined && !TIME_RANGES.has(timeRange)) {
        throw new Error("timeRange must be one of: d, w, m, y");
    }

    return {
        query,
        maxResults: normalizeInteger(input.maxResults, DEFAULT_SEARCH_MAX_RESULTS, MAX_SEARCH_RESULTS, "maxResults"),
        site: normalizeOptionalToken(input.site, "site"),
        region: normalizeRegion(input.region),
        timeRange,
        safeSearch: input.safeSearch ?? true,
        timeoutMs: normalizeInteger(input.timeoutMs, DEFAULT_SEARCH_TIMEOUT_MS, MAX_SEARCH_TIMEOUT_MS, "timeoutMs"),
    };
}

export function renderSearchResults(details: WebSearchDetails): string {
    if (details.results.length === 0) {
        return `No web_search results for: ${details.query}`;
    }

    const lines = [`web_search results for: ${details.query}`, ""];
    for (const result of details.results) {
        lines.push(`${result.rank}. ${result.title}`);
        lines.push(`   ${result.url}`);
        if (result.snippet) lines.push(`   ${result.snippet}`);
        if (result.metadata) lines.push(`   ${result.metadata}`);
        lines.push("");
    }
    return lines.join("\n").trimEnd();
}

export async function runWebSearch(
    pi: Pick<ExtensionAPI, "exec">,
    input: WebSearchInput,
    signal?: AbortSignal,
    deps: RunWebSearchDeps = {},
): Promise<ToolRunResult<WebSearchDetails>> {
    const normalized = normalizeSearchInput(input);
    const config = deps.config ?? readPiWebConfig();
    const envValue = deps.env ? deps.env[PI_WEB_PROVIDER_ENV] : process.env[PI_WEB_PROVIDER_ENV];
    const provider = resolveSearchProvider(config.searchProvider, envValue);
    const threshold = config.notifyAfterEmptyResults ?? DEFAULT_NOTIFY_AFTER_EMPTY_RESULTS;

    let details: WebSearchDetails;
    try {
        details = await runProvider(provider, pi, normalized, signal, deps);
    } catch (error) {
        throw withAdvice(error, deps.streak, threshold, provider);
    }

    if (details.results.length === 0) {
        if (deps.streak?.recordEmpty(threshold)) {
            details.notice = buildAdvice(provider, threshold);
        }
    } else {
        deps.streak?.recordSuccess();
    }

    const body = renderSearchResults(details);
    return {
        contentText: details.notice ? `${body}\n\n${details.notice}` : body,
        details,
    };
}

async function runProvider(
    provider: WebSearchProvider,
    pi: Pick<ExtensionAPI, "exec">,
    input: NormalizedWebSearchInput,
    signal: AbortSignal | undefined,
    deps: RunWebSearchDeps,
): Promise<WebSearchDetails> {
    if (provider === SEARCH_PROVIDERS.DEEPSEEK) {
        return runDeepSeekSearch(input, signal, { fetchImpl: deps.fetchImpl, env: deps.env });
    }
    return runDdgrSearch(pi, input, signal);
}

function buildAdvice(provider: WebSearchProvider, threshold: number): string {
    const alternative = provider === SEARCH_PROVIDERS.DEEPSEEK ? SEARCH_PROVIDERS.DDGR : SEARCH_PROVIDERS.DEEPSEEK;
    return [
        `web_search produced no usable results for the last ${threshold} searches with provider "${provider}".`,
        `Consider switching providers: set "searchProvider" to "${alternative}" in ${PI_WEB_CONFIG_FILE}`,
        `or export ${PI_WEB_PROVIDER_ENV}=${alternative}, or rephrase the query.`,
    ].join(" ");
}

function withAdvice(
    error: unknown,
    streak: EmptyStreak | undefined,
    threshold: number,
    provider: WebSearchProvider,
): Error {
    const cause = error instanceof Error ? error : new Error(String(error));
    if (!streak || cause.name === "AbortError" || !streak.recordEmpty(threshold)) return cause;
    return new Error(`${cause.message}\n\n${buildAdvice(provider, threshold)}`, { cause });
}
