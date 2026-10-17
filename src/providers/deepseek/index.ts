import {
    isRecord,
    SEARCH_PROVIDERS,
    type NormalizedWebSearchInput,
    type WebSearchDetails,
} from "../../types.ts";
import { resolveDeepSeekConfig } from "./config.ts";
import { mapDeepSeekResults } from "./parse.ts";
import { buildDeepSeekRequest } from "./request.ts";
import { DEEPSEEK_API_KEY_ENV, type DeepSeekSearchDeps } from "./types.ts";

export async function runDeepSeekSearch(
    input: NormalizedWebSearchInput,
    signal?: AbortSignal,
    deps: DeepSeekSearchDeps = {},
): Promise<WebSearchDetails> {
    const config = resolveDeepSeekConfig(deps.env);
    const request = buildDeepSeekRequest(input, config);
    const timeoutSignal = AbortSignal.timeout(input.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const fetchImpl = deps.fetchImpl ?? fetch;

    let response: Response;
    try {
        response = await fetchImpl(request.endpoint, {
            method: "POST",
            redirect: "error",
            headers: request.headers,
            body: JSON.stringify(request.body),
            signal: requestSignal,
        });
    } catch (error) {
        throw transportError(error, input.timeoutMs, signal, timeoutSignal);
    }

    if (!response.ok) {
        throw new Error(
            `deepseek search failed (HTTP ${response.status})${await readErrorDetail(response)}${httpHint(response.status)}`,
        );
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch (error) {
        if (signal?.aborted === true) throw error;
        throw new Error("deepseek search returned an unreadable response body", { cause: error });
    }

    return {
        query: input.query,
        provider: SEARCH_PROVIDERS.DEEPSEEK,
        endpoint: request.endpoint,
        results: mapDeepSeekResults(payload),
    };
}

function transportError(
    error: unknown,
    timeoutMs: number,
    callerSignal: AbortSignal | undefined,
    timeoutSignal: AbortSignal,
): Error {
    if (callerSignal?.aborted === true) {
        return error instanceof Error ? error : new Error(String(error));
    }
    if (timeoutSignal.aborted) {
        return new Error(`deepseek search timed out after ${timeoutMs}ms`, { cause: error });
    }
    return new Error(`deepseek search request failed: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
    });
}

async function readErrorDetail(response: Response): Promise<string> {
    try {
        const payload: unknown = await response.json();
        if (!isRecord(payload)) return "";
        const detail = typeof payload.error === "string"
            ? payload.error
            : isRecord(payload.error) && typeof payload.error.message === "string"
                ? payload.error.message
                : undefined;
        return detail && detail.trim() ? `: ${detail.trim()}` : "";
    } catch {
        // Gateway failures often answer with a non-JSON body; the status alone is enough.
        return "";
    }
}

function httpHint(status: number): string {
    if (status === 401) return `; check ${DEEPSEEK_API_KEY_ENV}`;
    if (status === 402) return "; the DeepSeek account balance is insufficient";
    if (status === 429) return "; the DeepSeek search QPS limit was reached, retry shortly or switch to ddgr";
    if (status >= 500) return "; DeepSeek reported a server error, retry later";
    return "";
}
