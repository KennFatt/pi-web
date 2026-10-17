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
