import type { ActiveModelRef } from "../../types.ts";

export const GEMINI_CODE_ASSIST_BASE_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal";
export const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_CODE_ASSIST_SEARCH_MODEL = "gemini-3.8-flash-low";
export const GEMINI_API_SEARCH_MODEL = "gemini-3.8-flash";
export const GEMINI_CODE_ASSIST_API = "google-code-assist";
export const GEMINI_GENERATIVE_AI_API = "google-generative-ai";
export const GOOGLE_OAUTH_PROJECT_HEADER = "x-pi-google-oauth-v2-project";

export type GeminiActiveModel = ActiveModelRef & {
    id: string;
    provider: string;
    api: string;
};

export interface GeminiResolvedAuth {
    ok: true;
    apiKey?: string;
    headers?: Record<string, string>;
}

export interface GeminiAuthFailure {
    ok: false;
    error: string;
}

export type GeminiAuthResult = GeminiResolvedAuth | GeminiAuthFailure;

export interface GeminiModelRegistry {
    getApiKeyAndHeaders(model: GeminiActiveModel): Promise<GeminiAuthResult>;
}

export interface GeminiSearchDeps {
    fetchImpl?: typeof fetch;
    activeModel?: GeminiActiveModel;
    modelRegistry?: GeminiModelRegistry;
}

export interface GeminiPreparedRequest {
    endpoint: string;
    body: unknown;
    headers: Record<string, string>;
}
