import type { WebSearchResult } from "../../types.ts";
import type { RawDdgrResult } from "./types.ts";

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
