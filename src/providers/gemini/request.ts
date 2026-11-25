import { randomUUID } from "node:crypto";
import type { NormalizedWebSearchInput } from "../../types.ts";
import {
    GEMINI_API_BASE_URL,
    GEMINI_API_SEARCH_MODEL,
    GEMINI_CODE_ASSIST_API,
    GEMINI_CODE_ASSIST_BASE_URL,
    GEMINI_CODE_ASSIST_SEARCH_MODEL,
    GEMINI_GENERATIVE_AI_API,
    GOOGLE_OAUTH_PROJECT_HEADER,
    type GeminiActiveModel,
    type GeminiPreparedRequest,
    type GeminiResolvedAuth,
} from "./types.ts";

const OS_TYPES: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" };
const ARCHITECTURES: Record<string, string> = { arm64: "arm64", x64: "amd64" };

function geminiUserAgent(): string {
    const osType = OS_TYPES[process.platform] ?? process.platform;
    const arch = ARCHITECTURES[process.arch] ?? process.arch;
    return `antigravity/cli/1.5.9 (aidev_client; os_type=${osType}; arch=${arch}; cl=1021519450; auth_method=consumer)`;
}

function trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, "");
}

function resolveBaseUrl(value: string | undefined, fallback: string): string {
    const trimmed = trimTrailingSlash(value?.trim() ?? "");
    return trimmed || fallback;
}

function findHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
    if (!headers) return undefined;
    const lowerName = name.toLowerCase();
    return Object.entries(headers)
        .filter(([key]) => key.toLowerCase() === lowerName)
        .map(([, value]) => value)
        .at(-1);
}

function forwardedHeaders(
    headers: Record<string, string> | undefined,
    excluded: string[],
): Record<string, string> {
    const lowerExcluded = new Set(excluded.map((name) => name.toLowerCase()));
    return Object.fromEntries(
        Object.entries(headers ?? {}).filter(([name]) => !lowerExcluded.has(name.toLowerCase())),
    );
}

export function buildGeminiRequest(
    input: NormalizedWebSearchInput,
    model: GeminiActiveModel,
    auth: GeminiResolvedAuth,
): GeminiPreparedRequest {
    if (model.api === GEMINI_CODE_ASSIST_API) return buildCodeAssistRequest(input, model, auth);
    if (model.api === GEMINI_GENERATIVE_AI_API) return buildGenerativeAiRequest(input, model, auth);
    throw new Error(
        `gemini search does not support api "${model.api}" for provider "${model.provider}"; switch providers via PI_WEB_SEARCH_PROVIDER`,
    );
}

function buildCodeAssistRequest(
    input: NormalizedWebSearchInput,
    model: GeminiActiveModel,
    auth: GeminiResolvedAuth,
): GeminiPreparedRequest {
    const project = findHeader(auth.headers, GOOGLE_OAUTH_PROJECT_HEADER)?.trim();
    if (!project) {
        throw new Error("Google AI login is incomplete; run /login again");
    }
    const baseUrl = resolveBaseUrl(model.baseUrl, GEMINI_CODE_ASSIST_BASE_URL);
    return {
        endpoint: `${baseUrl}:generateContent`,
        body: {
            model: GEMINI_CODE_ASSIST_SEARCH_MODEL,
            project,
            requestId: randomUUID(),
            userAgent: "antigravity",
            requestType: "agent",
            request: {
                contents: [{ role: "user", parts: [{ text: input.query }] }],
                tools: [{ googleSearch: {} }],
                generationConfig: {
                    thinkingConfig: { includeThoughts: false, thinkingLevel: "LOW" },
                },
            },
        },
        headers: {
            ...forwardedHeaders(auth.headers, [GOOGLE_OAUTH_PROJECT_HEADER, "user-agent", "authorization", "content-type", "accept"]),
            authorization: `Bearer ${auth.apiKey ?? ""}`,
            "content-type": "application/json",
            accept: "application/json",
            "user-agent": geminiUserAgent(),
        },
    };
}

function buildGenerativeAiRequest(
    input: NormalizedWebSearchInput,
    model: GeminiActiveModel,
    auth: GeminiResolvedAuth,
): GeminiPreparedRequest {
    const baseUrl = resolveBaseUrl(model.baseUrl, GEMINI_API_BASE_URL);
    return {
        endpoint: `${baseUrl}/models/${GEMINI_API_SEARCH_MODEL}:generateContent`,
        body: {
            contents: [{ role: "user", parts: [{ text: input.query }] }],
            tools: [{ google_search: {} }],
            generationConfig: {
                thinkingConfig: { thinkingLevel: "LOW" },
            },
        },
        headers: {
            ...forwardedHeaders(auth.headers, ["x-goog-api-key", "authorization", "content-type", "accept"]),
            "x-goog-api-key": auth.apiKey ?? "",
            "content-type": "application/json",
            accept: "application/json",
        },
    };
}
