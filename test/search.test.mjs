import test from "node:test";
import assert from "node:assert/strict";
import { buildDdgrArgs, normalizeSearchInput, parseDdgrJson, renderSearchResults } from "../src/search.ts";

const sample = JSON.stringify([
  { title: "A", url: "https://example.com/a", abstract: "Snippet A" },
  { title: "B", url: "https://example.com/b", abstract: "Snippet B", metadata: "meta" },
]);

test("parseDdgrJson maps valid results", () => {
  assert.deepEqual(parseDdgrJson(sample), [
    { rank: 1, title: "A", url: "https://example.com/a", snippet: "Snippet A" },
    { rank: 2, title: "B", url: "https://example.com/b", snippet: "Snippet B", metadata: "meta" },
  ]);
});

test("parseDdgrJson accepts empty result arrays", () => {
  assert.deepEqual(parseDdgrJson("[]"), []);
});

test("parseDdgrJson rejects malformed JSON", () => {
  assert.throws(() => parseDdgrJson("not json"), /malformed JSON/);
});

test("parseDdgrJson rejects missing fields", () => {
  assert.throws(() => parseDdgrJson(JSON.stringify([{ title: "A", url: "https://example.com" }])), /missing abstract/);
});

test("normalizeSearchInput sets defaults", () => {
  const normalized = normalizeSearchInput({ query: " frost signatures " });
  assert.equal(normalized.query, "frost signatures");
  assert.equal(normalized.maxResults, 8);
  assert.equal(normalized.region, "us-en");
  assert.equal(normalized.safeSearch, true);
  assert.equal(normalized.timeoutMs, 10_000);
});

test("normalizeSearchInput rejects leading bang queries", () => {
  assert.throws(() => normalizeSearchInput({ query: "!w rust" }), /bang queries/);
});

test("buildDdgrArgs includes defaults and optional flags", () => {
  const args = buildDdgrArgs(normalizeSearchInput({
    query: "frost",
    maxResults: 3,
    site: "ietf.org",
    region: "us-en",
    timeRange: "y",
    safeSearch: false,
  }));
  assert.deepEqual(args, [
    "--json",
    "--np",
    "--colorize=never",
    "-n",
    "3",
    "-r",
    "us-en",
    "-w",
    "ietf.org",
    "-t",
    "y",
    "--unsafe",
    "frost",
  ]);
});

test("renderSearchResults handles no results", () => {
  assert.match(renderSearchResults({ query: "none", provider: "ddgr", args: [], results: [] }), /No web_search results/);
});
