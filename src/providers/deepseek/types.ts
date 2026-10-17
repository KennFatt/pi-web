export const DEEPSEEK_SEARCH_ENDPOINT = "https://api.deepseek.com/v1/tools/search";
export const DEEPSEEK_API_KEY_ENV = "DEEPSEEK_API_KEY";
export const DEEPSEEK_MAX_COUNT = 50;

export const DEEPSEEK_TIME_WINDOW_DAYS = {
    d: 1,
    w: 7,
    m: 30,
    y: 365,
} as const;

export interface DeepSeekSearchBody {
    query: string;
    count: number;
    need_content: false;
}

export interface DeepSeekSearchConfig {
    endpoint: string;
    apiKey: string;
}

export interface DeepSeekSearchDeps {
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
}

export interface DeepSeekRawResult {
    title?: unknown;
    url?: unknown;
    snippet?: unknown;
    summary?: unknown;
    date?: unknown;
    site_name?: unknown;
}
