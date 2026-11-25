import { boundedExcerpt } from "../../truncate.ts";
import { isRecord, type WebSearchResult } from "../../types.ts";

export interface GeminiParsedResponse {
    answer?: string;
    results: WebSearchResult[];
}

interface MappedGroundingChunks {
    results: WebSearchResult[];
    rankByChunkIndex: Map<number, number>;
}

export function parseGeminiResponse(payload: unknown, maxResults: number): GeminiParsedResponse {
    const response = unwrapResponse(payload);
    if (!isRecord(response) || !Array.isArray(response.candidates) || response.candidates.length === 0) {
        throw new Error("gemini search returned an unexpected response body");
    }
    const candidate = response.candidates[0];
    if (!isRecord(candidate)) {
        throw new Error("gemini search returned an unexpected response body");
    }

    const text = extractText(candidate);
    const grounding = isRecord(candidate.groundingMetadata) ? candidate.groundingMetadata : {};
    const mapped = mapGroundingChunks(grounding.groundingChunks, maxResults);
    const { results, rankByChunkIndex } = mapped;

    if (results.length === 0) return { results: [] };
    if (!text.trim()) return { results };

    const cited = insertCitations(text, grounding.groundingSupports, rankByChunkIndex);
    return { answer: boundedExcerpt(cited), results };
}

function unwrapResponse(payload: unknown): unknown {
    if (isRecord(payload) && isRecord(payload.response)) return payload.response;
    return payload;
}

function extractText(candidate: Record<string, unknown>): string {
    if (!isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) return "";
    const texts: string[] = [];
    for (const part of candidate.content.parts) {
        if (!isRecord(part) || part.thought === true) continue;
        if (typeof part.text === "string") texts.push(part.text);
    }
    return texts.join("");
}

function mapGroundingChunks(chunks: unknown, maxResults: number): MappedGroundingChunks {
    const results: WebSearchResult[] = [];
    const rankByChunkIndex = new Map<number, number>();
    if (!Array.isArray(chunks)) return { results, rankByChunkIndex };
    for (const [chunkIndex, chunk] of chunks.entries()) {
        if (!isRecord(chunk) || !isRecord(chunk.web)) continue;
        const uri = typeof chunk.web.uri === "string" ? chunk.web.uri.trim() : "";
        if (!uri) continue;
        const title = typeof chunk.web.title === "string" && chunk.web.title.trim()
            ? chunk.web.title.trim()
            : uri;
        const rank = results.length + 1;
        results.push({ rank, title, url: uri, snippet: "" });
        rankByChunkIndex.set(chunkIndex, rank);
        if (results.length >= maxResults) break;
    }
    return { results, rankByChunkIndex };
}

function insertCitations(text: string, supports: unknown, rankByChunkIndex: Map<number, number>): string {
    if (!Array.isArray(supports) || supports.length === 0) return text;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const originalBytes = encoder.encode(text);

    const markersByEndIndex = new Map<number, Map<number, string>>();
    for (const support of supports) {
        if (!isRecord(support) || !isRecord(support.segment)) continue;
        const endIndex = support.segment.endIndex;
        if (typeof endIndex !== "number" || !Number.isInteger(endIndex)) continue;
        if (endIndex < 0 || endIndex > originalBytes.length) continue;
        if (!Array.isArray(support.groundingChunkIndices)) continue;
        let markers = markersByEndIndex.get(endIndex);
        if (!markers) {
            markers = new Map();
            markersByEndIndex.set(endIndex, markers);
        }
        for (const index of support.groundingChunkIndices) {
            if (typeof index !== "number" || !Number.isInteger(index)) continue;
            const rank = rankByChunkIndex.get(index);
            if (rank === undefined) continue;
            markers.set(rank, `[${rank}]`);
        }
    }
    const endIndices = [...markersByEndIndex.entries()]
        .filter(([, markers]) => markers.size > 0)
        .map(([endIndex]) => endIndex)
        .sort((a, b) => a - b);
    if (endIndices.length === 0) return text;

    const pieces: Uint8Array[] = [];
    let cursor = 0;
    for (const endIndex of endIndices) {
        const markers = markersByEndIndex.get(endIndex);
        const markerText = markers
            ? [...markers.keys()].sort((a, b) => a - b).map((rank) => markers.get(rank) ?? "").join("")
            : "";
        pieces.push(originalBytes.slice(cursor, endIndex), encoder.encode(markerText));
        cursor = endIndex;
    }
    pieces.push(originalBytes.slice(cursor));

    const totalLength = pieces.reduce((total, piece) => total + piece.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const piece of pieces) {
        combined.set(piece, offset);
        offset += piece.length;
    }
    return decoder.decode(combined);
}
