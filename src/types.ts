export const DEFAULT_SEARCH_MAX_RESULTS = 8;
export const MAX_SEARCH_RESULTS = 25;
export const DEFAULT_SEARCH_TIMEOUT_MS = 10_000;
export const MAX_SEARCH_TIMEOUT_MS = 30_000;
export const DEFAULT_NOTIFY_AFTER_EMPTY_RESULTS = 3;

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
export const MAX_FETCH_TIMEOUT_MS = 60_000;
export const DEFAULT_FETCH_MAX_LINES = 500;
export const DEFAULT_FETCH_RENDER_WAIT_MS = 2_000;
export const MAX_FETCH_RENDER_WAIT_MS = 10_000;
export const WEB_FETCH_PROBE_TIMEOUT_MS = 2_000;

export const SEARCH_PROVIDERS = {
    DDGR: "ddgr",
    DEEPSEEK: "deepseek",
} as const;

export type WebSearchProvider = (typeof SEARCH_PROVIDERS)[keyof typeof SEARCH_PROVIDERS];

export const DEFAULT_SEARCH_PROVIDER: WebSearchProvider = SEARCH_PROVIDERS.DDGR;

export type WebSearchTimeRange = "d" | "w" | "m" | "y";

export interface WebSearchInput {
    query: string;
    maxResults?: number;
    site?: string;
    region?: string;
    timeRange?: WebSearchTimeRange;
    safeSearch?: boolean;
    timeoutMs?: number;
}

export interface NormalizedWebSearchInput {
    query: string;
    maxResults: number;
    site?: string;
    region?: string;
    timeRange?: WebSearchTimeRange;
    safeSearch: boolean;
    timeoutMs: number;
}

export interface WebSearchResult {
    rank: number;
    title: string;
    url: string;
    snippet: string;
    metadata?: string;
}

export interface WebSearchDetails {
    query: string;
    provider: WebSearchProvider;
    results: WebSearchResult[];
    args?: string[];
    endpoint?: string;
    stderr?: string;
    notice?: string;
}

export interface ToolRunResult<Details> {
    contentText: string;
    details: Details;
}

export interface WebFetchInput {
    url: string | string[];
    timeoutMs?: number;
    maxLines?: number;
    renderWaitMs?: number;
    xml?: boolean;
}

export interface WebFetchDetails {
    urls: string[];
    text: string;
    truncated: boolean;
    exitCode: number;
    stderr?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
