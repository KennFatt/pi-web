import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_SEARCH_MAX_RESULTS,
  DEFAULT_SEARCH_REGION,
  DEFAULT_SEARCH_TIMEOUT_MS,
  MAX_SEARCH_RESULTS,
  MAX_SEARCH_TIMEOUT_MS,
  type NormalizedWebSearchInput,
  type ToolRunResult,
  type WebSearchDetails,
  type WebSearchInput,
  type WebSearchResult,
  type WebSearchTimeRange,
} from "./types.ts";
import { boundedExcerpt } from "./truncate.ts";

interface RawDdgrResult {
  title?: unknown;
  url?: unknown;
  abstract?: unknown;
  metadata?: unknown;
}

const TIME_RANGES = new Set<WebSearchTimeRange>(["d", "w", "m", "y"]);

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

function normalizeRegion(value: unknown): string {
  const region = normalizeOptionalToken(value, "region") ?? DEFAULT_SEARCH_REGION;
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

export function buildDdgrArgs(input: NormalizedWebSearchInput): string[] {
  const args = [
    "--json",
    "--np",
    "--colorize=never",
    "-n",
    String(input.maxResults),
    "-r",
    input.region,
  ];

  if (input.site) args.push("-w", input.site);
  if (input.timeRange) args.push("-t", input.timeRange);
  if (!input.safeSearch) args.push("--unsafe");
  args.push(input.query);
  return args;
}

export function parseDdgrJson(stdout: string): WebSearchResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout || "[]");
  } catch (error) {
    throw new Error(`ddgr returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("ddgr returned JSON that was not an array");
  }

  return parsed.map((raw: RawDdgrResult, index) => {
    if (!raw || typeof raw !== "object") {
      throw new Error(`ddgr result ${index + 1} was not an object`);
    }
    if (typeof raw.title !== "string") throw new Error(`ddgr result ${index + 1} is missing title`);
    if (typeof raw.url !== "string") throw new Error(`ddgr result ${index + 1} is missing url`);
    if (typeof raw.abstract !== "string") throw new Error(`ddgr result ${index + 1} is missing abstract`);

    return {
      rank: index + 1,
      title: raw.title,
      url: raw.url,
      snippet: raw.abstract,
      ...(typeof raw.metadata === "string" && raw.metadata ? { metadata: raw.metadata } : {}),
    };
  });
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
): Promise<ToolRunResult<WebSearchDetails>> {
  const normalized = normalizeSearchInput(input);
  const args = buildDdgrArgs(normalized);
  const result = await pi.exec("ddgr", args, { signal, timeout: normalized.timeoutMs });

  if (result.killed) {
    throw new Error(`ddgr timed out after ${normalized.timeoutMs}ms`);
  }

  if (result.code !== 0) {
    throw new Error(
      `ddgr failed with exit code ${result.code}\nstdout:\n${boundedExcerpt(result.stdout)}\nstderr:\n${boundedExcerpt(result.stderr)}`,
    );
  }

  const results = parseDdgrJson(result.stdout.trim() || "[]");
  const details: WebSearchDetails = {
    query: normalized.query,
    provider: "ddgr",
    args,
    results,
    ...(result.stderr.trim() ? { stderr: boundedExcerpt(result.stderr.trim()) } : {}),
  };

  return {
    contentText: renderSearchResults(details),
    details,
  };
}
