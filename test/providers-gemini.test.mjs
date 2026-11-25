import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchInput } from "../src/search.ts";
import { runGeminiSearch } from "../src/providers/gemini/index.ts";
import { parseGeminiResponse } from "../src/providers/gemini/parse.ts";
import { buildGeminiRequest } from "../src/providers/gemini/request.ts";

const CODE_ASSIST_MODEL = {
  id: "gemini-3.8-flash",
  provider: "google-oauth-v2",
  api: "google-code-assist",
  baseUrl: "https://daily-cloudcode-pa.googleapis.com/v1internal",
};
const CODE_ASSIST_AUTH = {
  ok: true,
  apiKey: "oauth-token",
  headers: { "x-pi-google-oauth-v2-project": "my-project", "x-custom": "keep" },
};
const API_MODEL = {
  id: "gemini-3.8-flash",
  provider: "google",
  api: "google-generative-ai",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
};
const API_AUTH = { ok: true, apiKey: "gemini-key", headers: {} };

function googlePayload(text, chunks, supports) {
  return {
    candidates: [
      {
        content: { role: "model", parts: [{ text }] },
        finishReason: "STOP",
        groundingMetadata: { groundingChunks: chunks, groundingSupports: supports ?? [] },
      },
    ],
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test("buildGeminiRequest builds the Code Assist envelope", () => {
  const request = buildGeminiRequest(normalizeSearchInput({ query: "frost" }), CODE_ASSIST_MODEL, CODE_ASSIST_AUTH);
  assert.equal(request.endpoint, "https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent");
  assert.equal(request.body.model, "gemini-3.8-flash-low");
  assert.equal(request.body.project, "my-project");
  assert.equal(request.body.userAgent, "antigravity");
  assert.equal(request.body.requestType, "agent");
  assert.deepEqual(request.body.request.tools, [{ googleSearch: {} }]);
  assert.deepEqual(request.body.request.contents, [{ role: "user", parts: [{ text: "frost" }] }]);
  assert.deepEqual(request.body.request.generationConfig, { thinkingConfig: { includeThoughts: false, thinkingLevel: "LOW" } });
  assert.equal(request.headers.authorization, "Bearer oauth-token");
  assert.match(request.headers["user-agent"], /^antigravity\/cli\//);
  assert.equal(request.headers["x-pi-google-oauth-v2-project"], undefined);
  assert.equal(request.headers["x-custom"], "keep");
});

test("buildGeminiRequest builds the Gemini Developer API request", () => {
  const request = buildGeminiRequest(normalizeSearchInput({ query: "frost" }), API_MODEL, API_AUTH);
  assert.equal(request.endpoint, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.deepEqual(request.body.tools, [{ google_search: {} }]);
  assert.deepEqual(request.body.contents, [{ role: "user", parts: [{ text: "frost" }] }]);
  assert.deepEqual(request.body.generationConfig, { thinkingConfig: { thinkingLevel: "LOW" } });
  assert.equal(request.headers["x-goog-api-key"], "gemini-key");
});

test("buildGeminiRequest falls back to default base URLs when baseUrl is missing or blank", () => {
  const codeAssist = buildGeminiRequest(
    normalizeSearchInput({ query: "frost" }),
    { id: "gemini-3.8-flash", provider: "google-oauth-v2", api: "google-code-assist" },
    CODE_ASSIST_AUTH,
  );
  assert.equal(codeAssist.endpoint, "https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent");
  const api = buildGeminiRequest(
    normalizeSearchInput({ query: "frost" }),
    { id: "gemini-3.8-flash", provider: "google", api: "google-generative-ai", baseUrl: "   " },
    API_AUTH,
  );
  assert.equal(api.endpoint, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
});

test("buildGeminiRequest replaces case-variant auth and content headers instead of duplicating them", () => {
  const request = buildGeminiRequest(normalizeSearchInput({ query: "frost" }), CODE_ASSIST_MODEL, {
    ok: true,
    apiKey: "oauth-token",
    headers: { "x-pi-google-oauth-v2-project": "my-project", Authorization: "Bearer stale", "Content-Type": "text/plain", Accept: "text/html", "X-Custom": "keep" },
  });
  const headerKeys = Object.keys(request.headers).map((key) => key.toLowerCase());
  assert.equal(headerKeys.filter((key) => key === "authorization").length, 1);
  assert.equal(headerKeys.filter((key) => key === "content-type").length, 1);
  assert.equal(headerKeys.filter((key) => key === "accept").length, 1);
  assert.equal(request.headers.authorization, "Bearer oauth-token");
  assert.equal(request.headers["content-type"], "application/json");
  assert.equal(request.headers.accept, "application/json");
  assert.equal(request.headers["X-Custom"], "keep");
});

test("buildGeminiRequest requires the Code Assist project header", () => {
  assert.throws(
    () => buildGeminiRequest(normalizeSearchInput({ query: "frost" }), CODE_ASSIST_MODEL, { ok: true, apiKey: "token", headers: {} }),
    /Google AI login is incomplete; run \/login again/,
  );
});

test("parseGeminiResponse maps chunks and inserts byte-offset citations", () => {
  const text = "Hello world.";
  const parsed = parseGeminiResponse(
    {
      response: googlePayload(text, [
        { web: { uri: "https://example.com/a", title: "A" } },
        { web: { uri: "https://example.com/b" } },
      ], [
        { segment: { endIndex: 5 }, groundingChunkIndices: [0] },
        { segment: { startIndex: 6, endIndex: 11 }, groundingChunkIndices: [1, 0] },
      ]),
    },
    8,
  );
  assert.deepEqual(parsed.results, [
    { rank: 1, title: "A", url: "https://example.com/a", snippet: "" },
    { rank: 2, title: "https://example.com/b", url: "https://example.com/b", snippet: "" },
  ]);
  assert.equal(parsed.answer, "Hello[1] world[1][2].");
});

test("parseGeminiResponse inserts citations at UTF-8 byte offsets", () => {
  const text = "héllo wörld";
  const byteLength = new TextEncoder().encode(text).length;
  const parsed = parseGeminiResponse(
    googlePayload(text, [{ web: { uri: "https://example.com/a", title: "A" } }], [
      { segment: { endIndex: byteLength }, groundingChunkIndices: [0] },
    ]),
    8,
  );
  assert.equal(parsed.answer, "héllo wörld[1]");
});

test("parseGeminiResponse filters thought parts", () => {
  const parsed = parseGeminiResponse(
    {
      candidates: [
        {
          content: { parts: [{ thought: true, text: "hidden" }, { text: "visible" }] },
          groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/a", title: "A" } }] },
        },
      ],
    },
    8,
  );
  assert.equal(parsed.answer, "visible");
});

test("parseGeminiResponse aligns citations when an earlier chunk is skipped", () => {
  const parsed = parseGeminiResponse(
    googlePayload("Answer.", [
      { web: { uri: "   ", title: "Skipped" } },
      { web: { uri: "https://example.com/a", title: "A" } },
      { noWeb: true },
      { web: { uri: "https://example.com/b", title: "B" } },
    ], [
      { segment: { endIndex: 7 }, groundingChunkIndices: [1, 3] },
    ]),
    8,
  );
  assert.deepEqual(parsed.results.map((result) => result.url), ["https://example.com/a", "https://example.com/b"]);
  assert.equal(parsed.answer, "Answer.[1][2]");
});

test("parseGeminiResponse slices results and filters citation indices", () => {
  const parsed = parseGeminiResponse(
    googlePayload("Answer.", [
      { web: { uri: "https://example.com/a", title: "A" } },
      { web: { uri: "https://example.com/b", title: "B" } },
    ], [
      { segment: { endIndex: 7 }, groundingChunkIndices: [0, 1] },
    ]),
    1,
  );
  assert.equal(parsed.results.length, 1);
  assert.equal(parsed.answer, "Answer.[1]");
});

test("parseGeminiResponse returns no answer when no chunks are grounded", () => {
  const parsed = parseGeminiResponse(
    googlePayload("Unsourced answer.", [], [{ segment: { endIndex: 5 }, groundingChunkIndices: [0] }]),
    8,
  );
  assert.deepEqual(parsed, { results: [] });
});

test("parseGeminiResponse rejects unexpected payloads", () => {
  assert.throws(() => parseGeminiResponse({ error: "nope" }, 8), /unexpected response body/);
  assert.throws(() => parseGeminiResponse(null, 8), /unexpected response body/);
});

test("runGeminiSearch maps a Code Assist response without calling the network for ddgr", async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(url, "https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    return jsonResponse({
      response: googlePayload("Answer[1].", [{ web: { uri: "https://example.com/a", title: "A" } }], []),
    });
  };
  const details = await runGeminiSearch(normalizeSearchInput({ query: "frost" }), undefined, {
    fetchImpl,
    activeModel: CODE_ASSIST_MODEL,
    modelRegistry: { async getApiKeyAndHeaders() { return CODE_ASSIST_AUTH; } },
  });
  assert.equal(details.provider, "gemini");
  assert.equal(details.endpoint, "https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent");
  assert.equal(details.results.length, 1);
  assert.equal(details.answer, "Answer[1].");
});

test("runGeminiSearch reports a missing credential with the provider hint", async () => {
  await assert.rejects(
    () => runGeminiSearch(normalizeSearchInput({ query: "frost" }), undefined, {
      activeModel: CODE_ASSIST_MODEL,
      modelRegistry: { async getApiKeyAndHeaders() { return { ok: false, error: "no auth" }; } },
    }),
    /gemini search requires credentials for google-oauth-v2.*run \/login again/,
  );
  await assert.rejects(
    () => runGeminiSearch(normalizeSearchInput({ query: "frost" }), undefined, {
      activeModel: API_MODEL,
      modelRegistry: { async getApiKeyAndHeaders() { return { ok: true, apiKey: "" }; } },
    }),
    /gemini search requires credentials for google.*GEMINI_API_KEY/,
  );
});

test("runGeminiSearch reports HTTP error hints", async () => {
  const cases = [
    [401, /check credentials for google/],
    [429, /rate limit or quota exceeded.*PI_WEB_SEARCH_PROVIDER/],
    [404, /request rejected.*PI_WEB_SEARCH_PROVIDER/],
    [500, /server error, retry later/],
  ];
  for (const [status, pattern] of cases) {
    await assert.rejects(
      () => runGeminiSearch(normalizeSearchInput({ query: "frost" }), undefined, {
        fetchImpl: async () => jsonResponse({ error: { message: "boom" } }, status),
        activeModel: API_MODEL,
        modelRegistry: { async getApiKeyAndHeaders() { return API_AUTH; } },
      }),
      new RegExp(`HTTP ${status}\\).*boom.*${pattern.source}`),
    );
  }
});

test("runGeminiSearch reports a timeout", async () => {
  const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  await assert.rejects(
    () => runGeminiSearch(normalizeSearchInput({ query: "frost", timeoutMs: 5 }), undefined, {
      fetchImpl,
      activeModel: API_MODEL,
      modelRegistry: { async getApiKeyAndHeaders() { return API_AUTH; } },
    }),
    /gemini search timed out after 5ms/,
  );
});

test("runGeminiSearch rethrows a caller abort instead of wrapping it", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchImpl = (_url, init) => {
    if (init.signal.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };
  await assert.rejects(
    () => runGeminiSearch(normalizeSearchInput({ query: "frost" }), controller.signal, {
      fetchImpl,
      activeModel: API_MODEL,
      modelRegistry: { async getApiKeyAndHeaders() { return API_AUTH; } },
    }),
    (error) => error.name === "AbortError",
  );
});

test("runGeminiSearch rejects an incomplete active model", async () => {
  await assert.rejects(
    () => runGeminiSearch(normalizeSearchInput({ query: "frost" }), undefined, {
      activeModel: { id: "gemini-3.8-flash" },
      modelRegistry: { async getApiKeyAndHeaders() { return API_AUTH; } },
    }),
    /requires an active whitelisted \*gemini\* model/,
  );
});

test("runGeminiSearch reports an unreadable response body", async () => {
  await assert.rejects(
    () => runGeminiSearch(normalizeSearchInput({ query: "frost" }), undefined, {
      fetchImpl: async () => new Response("not json", { status: 200 }),
      activeModel: API_MODEL,
      modelRegistry: { async getApiKeyAndHeaders() { return API_AUTH; } },
    }),
    /unreadable response body/,
  );
});
