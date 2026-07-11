import type { TruncationResult } from "@earendil-works/pi-coding-agent";

export const DEFAULT_SEARCH_MAX_RESULTS = 8;
export const MAX_SEARCH_RESULTS = 25;
export const DEFAULT_SEARCH_TIMEOUT_MS = 10_000;
export const MAX_SEARCH_TIMEOUT_MS = 30_000;
export const DEFAULT_SEARCH_REGION = "us-en";

export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
export const MAX_FETCH_TIMEOUT_MS = 60_000;
export const DEFAULT_FETCH_MAX_CHARS = 12_000;
export const MAX_FETCH_MAX_CHARS = 50_000;

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
  provider: "ddgr";
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
  maxChars?: number;
  includeComments?: boolean;
  includeTables?: boolean;
  includeLinks?: boolean;
  includeImages?: boolean;
  fast?: boolean;
}

export interface NormalizedWebFetchInput {
  url: string;
  timeoutMs: number;
  maxChars: number;
  includeComments: boolean;
  includeTables: boolean;
  includeLinks: boolean;
  includeImages: boolean;
  fast: boolean;
}

export interface ExtractedDocument {
  url: string;
  finalUrl?: string;
  title?: string;
  author?: string;
  date?: string;
  hostname?: string;
  sitename?: string;
  description?: string;
  fingerprint?: string;
  text: string;
}

export interface FetchArtifacts {
  tempDir: string;
  fullXmlPath?: string;
  fullTextPath: string;
}

export interface RawFetchResponse {
  status: number;
  finalUrl: string;
  contentType?: string;
  text: string;
}

export interface WebFetchDetails extends ExtractedDocument {
  provider: "trafilatura" | "http";
  args: string[];
  text: string;
  truncated: boolean;
  status?: number;
  contentType?: string;
  truncation?: TruncationResult;
  tempDir?: string;
  fullXmlPath?: string;
  fullTextPath?: string;
  stderr?: string;
}
