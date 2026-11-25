import {
    isRecord,
    SEARCH_BACKENDS,
    type NormalizedWebSearchInput,
    type WebSearchDetails,
} from "../../types.ts";
import { parseGeminiResponse } from "./parse.ts";
import { buildGeminiRequest } from "./request.ts";
import type { GeminiSearchDeps } from "./types.ts";

export async function runGeminiSearch(
    input: NormalizedWebSearchInput,
    signal?: AbortSignal,
    deps: GeminiSearchDeps = {},
): Promise<WebSearchDetails> {
    const model = deps.activeModel;
    if (!model?.id || !model.provider || !model.api) {
        throw new Error("gemini search requires an active whitelisted *gemini* model");
    }
    if (!deps.modelRegistry) {
        throw credentialError(model.provider);
    }

    const auth = await deps.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) throw credentialError(model.provider, auth.error);
    if (!auth.apiKey?.trim()) throw credentialError(model.provider);

    const request = buildGeminiRequest(input, model, auth);
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
            `gemini search failed (HTTP ${response.status})${await readErrorDetail(response)}${httpHint(response.status, model.provider)}`,
        );
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch (error) {
        if (signal?.aborted === true) throw error;
        if (timeoutSignal.aborted) throw transportError(error, input.timeoutMs, signal, timeoutSignal);
        throw new Error("gemini search returned an unreadable response body", { cause: error });
    }

    const parsed = parseGeminiResponse(payload, input.maxResults);
    const details: WebSearchDetails = {
        query: input.query,
        provider: SEARCH_BACKENDS.GEMINI,
        endpoint: request.endpoint,
        results: parsed.results,
    };
    if (parsed.answer) details.answer = parsed.answer;
    return details;
}

function credentialError(provider: string, detail?: string): Error {
    const suffix = detail ? `: ${detail}` : "";
    if (provider === "google-oauth-v2") {
        return new Error(`gemini search requires credentials for ${provider}${suffix}; run /login again`);
    }
    if (provider === "google") {
        return new Error(`gemini search requires credentials for ${provider}${suffix}; set GEMINI_API_KEY and restart Pi`);
    }
    return new Error(`gemini search requires credentials for ${provider}${suffix}; run /login again or set GEMINI_API_KEY`);
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
        return new Error(`gemini search timed out after ${timeoutMs}ms`, { cause: error });
    }
    return new Error(`gemini search request failed: ${error instanceof Error ? error.message : String(error)}`, {
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
                : typeof payload.message === "string"
                    ? payload.message
                    : undefined;
        return detail && detail.trim() ? `: ${detail.trim()}` : "";
    } catch {
        return "";
    }
}

function httpHint(status: number, provider: string): string {
    if (status === 401 || status === 403) return `; check credentials for ${provider}`;
    if (status === 429) return "; rate limit or quota exceeded, retry shortly or switch providers via PI_WEB_SEARCH_PROVIDER";
    if (status === 400 || status === 404) return "; request rejected (unsupported model or thinking config), check the model or switch providers via PI_WEB_SEARCH_PROVIDER";
    if (status >= 500) return "; server error, retry later";
    return "";
}
