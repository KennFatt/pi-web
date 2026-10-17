import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchInput } from "../src/search.ts";
import { resolveDeepSeekConfig } from "../src/providers/deepseek/config.ts";
import { runDeepSeekSearch } from "../src/providers/deepseek/index.ts";
import { mapDeepSeekResults } from "../src/providers/deepseek/parse.ts";
import { buildDeepSeekQuery, buildDeepSeekRequest } from "../src/providers/deepseek/request.ts";

const NOW = new Date("2026-06-15T00:00:00.000Z");
const CONFIG = { endpoint: "https://api.deepseek.com/v1/tools/search", apiKey: "secret" };

test("buildDeepSeekQuery translates site, region, and time range", () => {
  const query = buildDeepSeekQuery(
    normalizeSearchInput({ query: "frost", site: "ietf.org", region: "us-en", timeRange: "w" }),
    NOW,
  );
  assert.equal(query, "frost site:ietf.org lang:en after:2026-06-08");
});

test("buildDeepSeekQuery leaves a plain query untouched", () => {
  assert.equal(buildDeepSeekQuery(normalizeSearchInput({ query: "frost" }), NOW), "frost");
});

test("buildDeepSeekQuery does not duplicate an existing site clause", () => {
  const query = buildDeepSeekQuery(normalizeSearchInput({ query: "frost site:ietf.org", site: "ietf.org" }), NOW);
  assert.equal(query, "frost site:ietf.org");
});

test("buildDeepSeekQuery skips a region without a language suffix", () => {
  assert.equal(buildDeepSeekQuery(normalizeSearchInput({ query: "frost", region: "us" }), NOW), "frost");
});

test("buildDeepSeekRequest builds the API body and headers", () => {
  const request = buildDeepSeekRequest(normalizeSearchInput({ query: "frost", maxResults: 5 }), CONFIG, NOW);
  assert.deepEqual(request.body, { query: "frost", count: 5, need_content: false });
  assert.equal(request.endpoint, CONFIG.endpoint);
  assert.equal(request.headers.authorization, "Bearer secret");
  assert.equal(request.headers["content-type"], "application/json");
});

test("mapDeepSeekResults prefers summary and adds metadata", () => {
  const results = mapDeepSeekResults({
    results: [
      { title: "A", url: "https://example.com/a", summary: "Long summary", snippet: "Short", site_name: "Example", date: "2026-06-01T00:00:00+00:00" },
      { title: "", url: "https://example.com/b", snippet: "Short" },
      { title: "no url" },
    ],
  });
  assert.deepEqual(results, [
    { rank: 1, title: "A", url: "https://example.com/a", snippet: "Long summary", metadata: "Example - 2026-06-01T00:00:00+00:00" },
    { rank: 2, title: "https://example.com/b", url: "https://example.com/b", snippet: "Short" },
  ]);
});

test("mapDeepSeekResults accepts empty result arrays", () => {
  assert.deepEqual(mapDeepSeekResults({ results: [] }), []);
});

test("mapDeepSeekResults rejects unexpected payloads", () => {
  assert.throws(() => mapDeepSeekResults({ error: "nope" }), /unexpected response body/);
  assert.throws(() => mapDeepSeekResults(null), /unexpected response body/);
});

test("resolveDeepSeekConfig requires the API key", () => {
  assert.throws(() => resolveDeepSeekConfig({}), /DEEPSEEK_API_KEY/);
  assert.deepEqual(resolveDeepSeekConfig({ DEEPSEEK_API_KEY: " secret " }), { ...CONFIG });
});

test("runDeepSeekSearch maps a successful response", async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(url, CONFIG.endpoint);
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    const body = JSON.parse(init.body);
    assert.equal(body.query, "frost");
    return new Response(JSON.stringify({ results: [{ title: "A", url: "https://example.com/a", snippet: "S" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const details = await runDeepSeekSearch(
    normalizeSearchInput({ query: "frost" }),
    undefined,
    { fetchImpl, env: { DEEPSEEK_API_KEY: "secret" } },
  );
  assert.equal(details.provider, "deepseek");
  assert.equal(details.endpoint, CONFIG.endpoint);
  assert.deepEqual(details.results, [{ rank: 1, title: "A", url: "https://example.com/a", snippet: "S" }]);
});

test("runDeepSeekSearch reports the API error detail", async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ error: { message: "the Search QPS limit was exceeded", type: "invalid_request_error" } }),
    { status: 429, headers: { "content-type": "application/json" } },
  );

  await assert.rejects(
    () => runDeepSeekSearch(normalizeSearchInput({ query: "frost" }), undefined, {
      fetchImpl,
      env: { DEEPSEEK_API_KEY: "secret" },
    }),
    /HTTP 429\).*QPS limit was exceeded.*retry shortly/,
  );
});

test("runDeepSeekSearch reports a timeout", async () => {
  const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });

  await assert.rejects(
    () => runDeepSeekSearch(normalizeSearchInput({ query: "frost", timeoutMs: 5 }), undefined, {
      fetchImpl,
      env: { DEEPSEEK_API_KEY: "secret" },
    }),
    /timed out after 5ms/,
  );
});
