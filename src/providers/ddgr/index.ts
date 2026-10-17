import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { boundedExcerpt } from "../../truncate.ts";
import { SEARCH_PROVIDERS, type NormalizedWebSearchInput, type WebSearchDetails } from "../../types.ts";
import { parseDdgrJson } from "./parse.ts";
import { buildDdgrArgs } from "./request.ts";
import { DDGR_BINARY } from "./types.ts";

export async function runDdgrSearch(
    pi: Pick<ExtensionAPI, "exec">,
    input: NormalizedWebSearchInput,
    signal?: AbortSignal,
): Promise<WebSearchDetails> {
    const args = buildDdgrArgs(input);
    const result = await pi.exec(DDGR_BINARY, args, { signal, timeout: input.timeoutMs });

    if (result.killed) {
        throw new Error(`${DDGR_BINARY} timed out after ${input.timeoutMs}ms`);
    }

    if (result.code !== 0) {
        throw new Error(
            `${DDGR_BINARY} failed with exit code ${result.code}\nstdout:\n${boundedExcerpt(result.stdout)}\nstderr:\n${boundedExcerpt(result.stderr)}`,
        );
    }

    return {
        query: input.query,
        provider: SEARCH_PROVIDERS.DDGR,
        args,
        results: parseDdgrJson(result.stdout.trim() || "[]"),
        ...(result.stderr.trim() ? { stderr: boundedExcerpt(result.stderr.trim()) } : {}),
    };
}
