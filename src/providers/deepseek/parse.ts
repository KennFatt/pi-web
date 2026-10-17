import { isRecord, type WebSearchResult } from "../../types.ts";
import type { DeepSeekRawResult } from "./types.ts";

export function mapDeepSeekResults(payload: unknown): WebSearchResult[] {
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
        throw new Error("deepseek search returned an unexpected response body");
    }

    const results: WebSearchResult[] = [];
    for (const item of payload.results) {
        const url = readField(item, "url");
        if (!url) continue;

        const metadata = buildMetadata(item);
        results.push({
            rank: results.length + 1,
            title: readField(item, "title") ?? url,
            url,
            snippet: readField(item, "summary") ?? readField(item, "snippet") ?? "",
            ...(metadata ? { metadata } : {}),
        });
    }

    return results;
}

function readField(value: unknown, key: keyof DeepSeekRawResult): string | undefined {
    if (!isRecord(value)) return undefined;
    const field = value[key];
    return typeof field === "string" && field.trim() ? field.trim() : undefined;
}

function buildMetadata(value: unknown): string | undefined {
    const siteName = readField(value, "site_name");
    const publishedAt = readField(value, "date");
    if (siteName && publishedAt) return `${siteName} - ${publishedAt}`;
    return siteName ?? publishedAt;
}
