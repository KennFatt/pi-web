import { DEEPSEEK_API_KEY_ENV, DEEPSEEK_SEARCH_ENDPOINT, type DeepSeekSearchConfig } from "./types.ts";

export function resolveDeepSeekConfig(env: NodeJS.ProcessEnv = process.env): DeepSeekSearchConfig {
    const apiKey = env[DEEPSEEK_API_KEY_ENV]?.trim();
    if (!apiKey) {
        throw new Error(
            `deepseek search requires ${DEEPSEEK_API_KEY_ENV}; export it before launching Pi, or set "searchProvider" to "ddgr" in pi-web.json`,
        );
    }

    return { endpoint: DEEPSEEK_SEARCH_ENDPOINT, apiKey };
}
