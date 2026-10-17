import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchInput } from "../src/search.ts";
import { parseDdgrJson } from "../src/providers/ddgr/parse.ts";
import { buildDdgrArgs } from "../src/providers/ddgr/request.ts";

const sample = JSON.stringify([
  { title: "A", url: "https://example.com/a", abstract: "Snippet A" },
  { title: "B", url: "https://example.com/b", abstract: "Snippet B", metadata: "meta" },
]);

test("buildDdgrArgs includes defaults and optional flags", () => {
  const args = buildDdgrArgs(normalizeSearchInput({
    query: "frost",
    maxResults: 3,
    site: "ietf.org",
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

test("buildDdgrArgs prefers an explicit region", () => {
  const args = buildDdgrArgs(normalizeSearchInput({ query: "frost", region: "id-id" }));
  assert.deepEqual(args.slice(-3), ["-r", "id-id", "frost"]);
});

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
