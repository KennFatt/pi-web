import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchInput, renderSearchResults } from "../src/search.ts";

test("normalizeSearchInput sets defaults", () => {
  const normalized = normalizeSearchInput({ query: " frost signatures " });
  assert.equal(normalized.query, "frost signatures");
  assert.equal(normalized.maxResults, 8);
  assert.equal(normalized.region, undefined);
  assert.equal(normalized.safeSearch, true);
  assert.equal(normalized.timeoutMs, 10_000);
});

test("normalizeSearchInput keeps an explicit region", () => {
  assert.equal(normalizeSearchInput({ query: "frost", region: "id-id" }).region, "id-id");
});

test("normalizeSearchInput rejects leading bang queries", () => {
  assert.throws(() => normalizeSearchInput({ query: "!w rust" }), /bang queries/);
});

test("normalizeSearchInput rejects an invalid time range", () => {
  assert.throws(() => normalizeSearchInput({ query: "frost", timeRange: "x" }), /timeRange must be one of/);
});

test("renderSearchResults handles no results", () => {
  assert.match(renderSearchResults({ query: "none", provider: "ddgr", results: [] }), /No web_search results/);
});

test("renderSearchResults renders ranked results", () => {
  const text = renderSearchResults({
    query: "frost",
    provider: "deepseek",
    results: [{ rank: 1, title: "A", url: "https://example.com/a", snippet: "Snippet", metadata: "Example - 2026-01-01" }],
  });
  assert.match(text, /1\. A/);
  assert.match(text, /https:\/\/example\.com\/a/);
  assert.match(text, /Snippet/);
  assert.match(text, /Example - 2026-01-01/);
});
