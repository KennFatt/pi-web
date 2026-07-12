export const DEFAULT_SEARCH_MAX_RESULTS = 8;
export const MAX_SEARCH_RESULTS = 25;
export const DEFAULT_SEARCH_TIMEOUT_MS = 10_000;
export const MAX_SEARCH_TIMEOUT_MS = 30_000;
export const DEFAULT_SEARCH_REGION = 'us-en';

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
export const MAX_FETCH_TIMEOUT_MS = 60_000;
export const DEFAULT_FETCH_MAX_LINES = 500;
export const DEFAULT_FETCH_RENDER_WAIT_MS = 2_000;
export const MAX_FETCH_RENDER_WAIT_MS = 10_000;
export const WEB_FETCH_PROBE_TIMEOUT_MS = 2_000;

export type WebSearchTimeRange = 'd' | 'w' | 'm' | 'y';

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
  region: string;
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
  provider: 'ddgr';
  args: string[];
  results: WebSearchResult[];
  stderr?: string;
}

export interface ToolRunResult<Details> {
  contentText: string;
  details: Details;
}

export interface WebFetchInput {
  url: string;
  timeoutMs?: number;
  maxLines?: number;
  renderWaitMs?: number;
  xml?: boolean;
}

export interface WebFetchDetails {
  url: string;
  text: string;
  truncated: boolean;
  exitCode: number;
  stderr?: string;
}
