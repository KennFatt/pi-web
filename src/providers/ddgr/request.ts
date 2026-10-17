import type { NormalizedWebSearchInput } from "../../types.ts";
import { DEFAULT_SEARCH_REGION } from "./types.ts";

export function buildDdgrArgs(input: NormalizedWebSearchInput): string[] {
    const args = [
        "--json",
        "--np",
        "--colorize=never",
        "-n",
        String(input.maxResults),
        "-r",
        input.region ?? DEFAULT_SEARCH_REGION,
    ];

    if (input.site) args.push("-w", input.site);
    if (input.timeRange) args.push("-t", input.timeRange);
    if (!input.safeSearch) args.push("--unsafe");
    args.push(input.query);
    return args;
}
