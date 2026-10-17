import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
    DEFAULT_SEARCH_PROVIDER,
    isRecord,
    SEARCH_PROVIDERS,
    type WebSearchProvider,
} from "./types.ts";

export const PI_WEB_PROVIDER_ENV = "PI_WEB_SEARCH_PROVIDER";
export const PI_WEB_CONFIG_FILE = "pi-web.json";

export interface PiWebConfig {
    searchProvider?: WebSearchProvider;
    notifyAfterEmptyResults?: number;
}

export function piWebConfigPath(): string {
    return join(getAgentDir(), PI_WEB_CONFIG_FILE);
}

export function readPiWebConfig(filePath: string = piWebConfigPath()): PiWebConfig {
    if (!existsSync(filePath)) return {};

    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch (error) {
        throw new Error(
            `pi-web config at ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    if (!isRecord(raw)) {
        throw new Error(`pi-web config at ${filePath} must be a JSON object`);
    }

    const config: PiWebConfig = {};
    if (raw.searchProvider !== undefined) {
        config.searchProvider = parseProvider(raw.searchProvider, filePath);
    }
    if (raw.notifyAfterEmptyResults !== undefined) {
        config.notifyAfterEmptyResults = parseThreshold(raw.notifyAfterEmptyResults, filePath);
    }
    return config;
}

export function resolveSearchProvider(
    fileValue?: string,
    envValue?: string,
): WebSearchProvider {
    const raw = envValue?.trim() || fileValue?.trim();
    if (!raw) return DEFAULT_SEARCH_PROVIDER;

    const provider = matchProvider(raw);
    if (!provider) {
        throw new Error(`unknown web_search provider "${raw}"; use one of: ${Object.values(SEARCH_PROVIDERS).join(", ")}`);
    }
    return provider;
}

export interface EmptyStreak {
    /** Record a search that produced nothing usable; true when the advice threshold was crossed. */
    recordEmpty(threshold: number): boolean;
    recordSuccess(): void;
    reset(): void;
}

export function createEmptyStreak(): EmptyStreak {
    let count = 0;
    let notified = false;

    return {
        recordEmpty(threshold) {
            if (!Number.isInteger(threshold) || threshold < 1) return false;
            count += 1;
            if (count < threshold || notified) return false;
            notified = true;
            return true;
        },
        recordSuccess() {
            count = 0;
            notified = false;
        },
        reset() {
            count = 0;
            notified = false;
        },
    };
}

function matchProvider(value: string): WebSearchProvider | undefined {
    const normalized = value.trim().toLowerCase();
    switch (normalized) {
        case SEARCH_PROVIDERS.DDGR:
            return SEARCH_PROVIDERS.DDGR;
        case SEARCH_PROVIDERS.DEEPSEEK:
            return SEARCH_PROVIDERS.DEEPSEEK;
        default:
            return undefined;
    }
}

function parseProvider(value: unknown, filePath: string): WebSearchProvider {
    if (typeof value !== "string") {
        throw new Error(`pi-web config at ${filePath}: searchProvider must be a string`);
    }
    const provider = matchProvider(value);
    if (!provider) {
        throw new Error(
            `pi-web config at ${filePath}: unknown searchProvider "${value}"; use one of: ${Object.values(SEARCH_PROVIDERS).join(", ")}`,
        );
    }
    return provider;
}

function parseThreshold(value: unknown, filePath: string): number {
    if (!Number.isInteger(value) || Number(value) < 0) {
        throw new Error(`pi-web config at ${filePath}: notifyAfterEmptyResults must be a non-negative integer`);
    }
    return Number(value);
}
