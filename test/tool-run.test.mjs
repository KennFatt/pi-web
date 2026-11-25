import test from "node:test";
import assert from "node:assert/strict";
import { runWebSearch } from "../src/search.ts";
import { createEmptyStreak } from "../src/search-provider.ts";

function ddgrStub(stdout, code = 0, stderr = "") {
  const calls = [];
  return {
    calls,
    async exec(command, args, options) {
      calls.push({ command, args, options });
      return { stdout, stderr, code, killed: false };
    },
  };
}

test("runWebSearch executes ddgr by default and returns details", async () => {
  const fakePi = ddgrStub(JSON.stringify([{ title: "A", url: "https://example.com", abstract: "Snippet" }]));

  const result = await runWebSearch(fakePi, { query: "example", maxResults: 1 }, undefined, { env: {}, config: {} });
  assert.equal(fakePi.calls[0].command, "ddgr");
  assert.equal(fakePi.calls[0].options.timeout, 10_000);
  assert.equal(result.details.provider, "ddgr");
  assert.deepEqual(result.details.results, [{ rank: 1, title: "A", url: "https://example.com", snippet: "Snippet" }]);
  assert.match(result.contentText, /web_search results/);
});

test("runWebSearch reports a ddgr timeout", async () => {
  const fakePi = { async exec() { return { stdout: "", stderr: "", code: 0, killed: true }; } };
  await assert.rejects(() => runWebSearch(fakePi, { query: "example" }, undefined, { env: {}, config: {} }), /timed out/);
});

test("runWebSearch dispatches to the deepseek backend", async () => {
  const fakePi = ddgrStub("[]");
  const result = await runWebSearch(fakePi, { query: "example" }, undefined, {
    config: { searchProvider: "deepseek" },
    env: { DEEPSEEK_API_KEY: "secret" },
    fetchImpl: async () => new Response(
      JSON.stringify({ results: [{ title: "A", url: "https://example.com/a", snippet: "S" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  });

  assert.equal(fakePi.calls.length, 0);
  assert.equal(result.details.provider, "deepseek");
  assert.equal(result.details.results.length, 1);
});

test("runWebSearch prefers the environment provider override", async () => {
  const fakePi = ddgrStub("[]");
  const result = await runWebSearch(fakePi, { query: "example" }, undefined, {
    config: { searchProvider: "deepseek" },
    env: { PI_WEB_SEARCH_PROVIDER: "ddgr" },
  });

  assert.equal(result.details.provider, "ddgr");
  assert.equal(fakePi.calls.length, 1);
});

test("runWebSearch dispatches to the gemini backend for a whitelisted active model", async () => {
  const fakePi = ddgrStub("[]");
  const result = await runWebSearch(fakePi, { query: "example" }, undefined, {
    config: { searchProvider: "deepseek" },
    env: {},
    activeModel: { id: "gemini-3.8-flash", provider: "google-oauth-v2", api: "google-code-assist", baseUrl: "https://daily-cloudcode-pa.googleapis.com/v1internal" },
    modelRegistry: {
      async getApiKeyAndHeaders() {
        return { ok: true, apiKey: "token", headers: { "x-pi-google-oauth-v2-project": "project" } };
      },
    },
    fetchImpl: async () => new Response(
      JSON.stringify({
        response: {
          candidates: [{
            content: { parts: [{ text: "Grounded answer." }] },
            groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/a", title: "A" } }] },
          }],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  });

  assert.equal(fakePi.calls.length, 0);
  assert.equal(result.details.provider, "gemini");
  assert.equal(result.details.answer, "Grounded answer.");
  assert.equal(result.details.results.length, 1);
  assert.ok(result.contentText.indexOf("Grounded answer.") < result.contentText.indexOf("1. A"));
});

test("runWebSearch env override bypasses an active Gemini model", async () => {
  const fakePi = ddgrStub(JSON.stringify([{ title: "A", url: "https://example.com", abstract: "S" }]));
  const result = await runWebSearch(fakePi, { query: "example" }, undefined, {
    config: {},
    env: { PI_WEB_SEARCH_PROVIDER: "ddgr" },
    activeModel: { id: "gemini-3.8-flash", provider: "google", api: "google-generative-ai", baseUrl: "https://example.com" },
    modelRegistry: { async getApiKeyAndHeaders() { throw new Error("must not be called"); } },
  });
  assert.equal(result.details.provider, "ddgr");
  assert.equal(fakePi.calls.length, 1);
});

test("runWebSearch counts empty Gemini grounding toward the streak with Gemini advice", async () => {
  const fakePi = ddgrStub("[]");
  const streak = createEmptyStreak();
  const options = {
    config: { notifyAfterEmptyResults: 1 },
    env: {},
    streak,
    activeModel: { id: "gemini-3.8-flash", provider: "google", api: "google-generative-ai", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
    modelRegistry: { async getApiKeyAndHeaders() { return { ok: true, apiKey: "key" }; } },
    fetchImpl: async () => new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "No search." }] }, groundingMetadata: { groundingChunks: [] } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  };
  const result = await runWebSearch(fakePi, { query: "example" }, undefined, options);
  assert.equal(result.details.provider, "gemini");
  assert.equal(result.details.answer, undefined);
  assert.match(result.contentText, /Gemini may answer without using Google Search grounding/);
});

test("runWebSearch does not count a caller abort on Gemini toward the empty streak", async () => {
  const fakePi = ddgrStub("[]");
  const streak = createEmptyStreak();
  const controller = new AbortController();
  controller.abort();
  const run = (fetchImpl) => runWebSearch(fakePi, { query: "example" }, controller.signal, {
    config: { notifyAfterEmptyResults: 2 },
    env: {},
    streak,
    activeModel: { id: "gemini-3.8-flash", provider: "google", api: "google-generative-ai", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
    modelRegistry: { async getApiKeyAndHeaders() { return { ok: true, apiKey: "key" }; } },
    fetchImpl,
  });
  const abortFetch = (_url, init) => {
    if (init.signal.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };
  await assert.rejects(() => run(abortFetch), (error) => error.name === "AbortError");

  const emptyFetch = async () => new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: "No search." }] }, groundingMetadata: { groundingChunks: [] } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const controller2 = new AbortController();
  const result = await runWebSearch(fakePi, { query: "example" }, controller2.signal, {
    config: { notifyAfterEmptyResults: 2 },
    env: {},
    streak,
    activeModel: { id: "gemini-3.8-flash", provider: "google", api: "google-generative-ai", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
    modelRegistry: { async getApiKeyAndHeaders() { return { ok: true, apiKey: "key" }; } },
    fetchImpl: emptyFetch,
  });
  assert.equal(result.details.notice, undefined);
});

test("runWebSearch notifies once the empty streak threshold is crossed", async () => {
  const fakePi = ddgrStub("[]");
  const streak = createEmptyStreak();
  const options = { env: {}, config: { notifyAfterEmptyResults: 2 }, streak };

  const first = await runWebSearch(fakePi, { query: "example" }, undefined, options);
  assert.equal(first.details.notice, undefined);

  const second = await runWebSearch(fakePi, { query: "example" }, undefined, options);
  assert.match(second.contentText, /Consider switching providers/);

  const third = await runWebSearch(fakePi, { query: "example" }, undefined, options);
  assert.equal(third.details.notice, undefined);
});

test("runWebSearch counts provider failures toward the empty streak", async () => {
  const fakePi = ddgrStub("", 1, "rate limited");
  const streak = createEmptyStreak();
  const options = { env: {}, config: { notifyAfterEmptyResults: 2 }, streak };

  await assert.rejects(() => runWebSearch(fakePi, { query: "example" }, undefined, options), /ddgr failed/);
  await assert.rejects(
    () => runWebSearch(fakePi, { query: "example" }, undefined, options),
    /ddgr failed[\s\S]*Consider switching providers/,
  );
});

test("runWebSearch resets the streak after a successful search", async () => {
  const streak = createEmptyStreak();
  const emptyPi = ddgrStub("[]");
  const fullPi = ddgrStub(JSON.stringify([{ title: "A", url: "https://example.com", abstract: "S" }]));
  const options = { env: {}, config: { notifyAfterEmptyResults: 2 }, streak };

  await runWebSearch(emptyPi, { query: "example" }, undefined, options);
  await runWebSearch(fullPi, { query: "example" }, undefined, options);
  const result = await runWebSearch(emptyPi, { query: "example" }, undefined, options);
  assert.equal(result.details.notice, undefined);
});
