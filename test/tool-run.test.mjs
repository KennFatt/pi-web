import test from "node:test";
import assert from "node:assert/strict";
import { runWebSearch } from "../src/search.ts";

test("runWebSearch executes ddgr and returns details", async () => {
  const calls = [];
  const fakePi = {
    async exec(command, args, options) {
      calls.push({ command, args, options });
      return {
        stdout: JSON.stringify([{ title: "A", url: "https://example.com", abstract: "Snippet" }]),
        stderr: "",
        code: 0,
        killed: false,
      };
    },
  };

  const result = await runWebSearch(fakePi, { query: "example", maxResults: 1 });
  assert.equal(calls[0].command, "ddgr");
  assert.equal(calls[0].options.timeout, 10_000);
  assert.deepEqual(result.details.results, [{ rank: 1, title: "A", url: "https://example.com", snippet: "Snippet" }]);
  assert.match(result.contentText, /web_search results/);
});

test("runWebSearch reports timeout", async () => {
  const fakePi = {
    async exec() {
      return { stdout: "", stderr: "", code: 0, killed: true };
    },
  };
  await assert.rejects(() => runWebSearch(fakePi, { query: "example" }), /timed out/);
});
