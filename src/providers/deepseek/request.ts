import type { NormalizedWebSearchInput, WebSearchTimeRange } from "../../types.ts";
import {
    DEEPSEEK_MAX_COUNT,
    DEEPSEEK_TIME_WINDOW_DAYS,
    type DeepSeekSearchBody,
    type DeepSeekSearchConfig,
} from "./types.ts";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DeepSeekPreparedRequest {
    endpoint: string;
    body: DeepSeekSearchBody;
    headers: Record<string, string>;
}

export function buildDeepSeekQuery(input: NormalizedWebSearchInput, now: Date = new Date()): string {
    const clauses: string[] = [];

    if (input.site && !hasSiteClause(input.query, input.site)) {
        clauses.push(`site:${input.site}`);
    }
    const language = regionLanguage(input.region);
    if (language) {
        clauses.push(`lang:${language}`);
    }
    if (input.timeRange) {
        clauses.push(`after:${afterDate(input.timeRange, now)}`);
    }

    return clauses.length === 0 ? input.query : `${input.query} ${clauses.join(" ")}`;
}

export function buildDeepSeekRequest(
    input: NormalizedWebSearchInput,
    config: DeepSeekSearchConfig,
    now: Date = new Date(),
): DeepSeekPreparedRequest {
    return {
        endpoint: config.endpoint,
        body: {
            query: buildDeepSeekQuery(input, now),
            count: Math.min(input.maxResults, DEEPSEEK_MAX_COUNT),
            need_content: false,
        },
        headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
            accept: "application/json",
        },
    };
}

function hasSiteClause(query: string, site: string): boolean {
    return query.toLowerCase().includes(`site:${site.toLowerCase()}`);
}

function regionLanguage(region: string | undefined): string | undefined {
    if (!region) return undefined;
    const parts = region.toLowerCase().split(/[-_]/);
    if (parts.length < 2) return undefined;
    const suffix = parts[parts.length - 1];
    return /^[a-z]{2}$/.test(suffix) ? suffix : undefined;
}

function afterDate(timeRange: WebSearchTimeRange, now: Date): string {
    const days = DEEPSEEK_TIME_WINDOW_DAYS[timeRange];
    return new Date(now.getTime() - days * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}
