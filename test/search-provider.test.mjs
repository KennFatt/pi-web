import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseSearchProvider, createEmptyStreak, isWhitelistedGeminiModel, readPiWebConfig, resolveSearchProvider } from "../src/search-provider.ts";

function withConfigFile(content, run) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-config-"));
  const file = join(dir, "pi-web.json");
  try {
    if (content !== undefined) writeFileSync(file, content, "utf-8");
    return run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("resolveSearchProvider defaults to ddgr", () => {
  assert.equal(resolveSearchProvider(undefined, undefined), "ddgr");
  assert.equal(resolveSearchProvider("", ""), "ddgr");
});

test("resolveSearchProvider reads the config value", () => {
  assert.equal(resolveSearchProvider("deepseek", undefined), "deepseek");
});

test("resolveSearchProvider lets the environment override the config file", () => {
  assert.equal(resolveSearchProvider("ddgr", "deepseek"), "deepseek");
  assert.equal(resolveSearchProvider("deepseek", "ddgr"), "ddgr");
});

test("resolveSearchProvider rejects an unknown value", () => {
  assert.throws(() => resolveSearchProvider(undefined, "bing"), /unknown web_search provider "bing"/);
});

test("readPiWebConfig returns defaults without a file", () => {
  withConfigFile(undefined, (file) => {
    assert.deepEqual(readPiWebConfig(file), {});
  });
});

test("readPiWebConfig reads the provider and threshold", () => {
  withConfigFile(JSON.stringify({ searchProvider: "deepseek", notifyAfterEmptyResults: 5 }), (file) => {
    assert.deepEqual(readPiWebConfig(file), { searchProvider: "deepseek", notifyAfterEmptyResults: 5 });
  });
});

test("readPiWebConfig rejects malformed content", () => {
  withConfigFile("not json", (file) => {
    assert.throws(() => readPiWebConfig(file), /not valid JSON/);
  });
  withConfigFile("[]", (file) => {
    assert.throws(() => readPiWebConfig(file), /must be a JSON object/);
  });
});

test("readPiWebConfig rejects invalid values", () => {
  withConfigFile(JSON.stringify({ searchProvider: "bing" }), (file) => {
    assert.throws(() => readPiWebConfig(file), /unknown searchProvider "bing"/);
  });
  withConfigFile(JSON.stringify({ notifyAfterEmptyResults: -1 }), (file) => {
    assert.throws(() => readPiWebConfig(file), /non-negative integer/);
  });
});

test("isWhitelistedGeminiModel accepts whitelisted Gemini models", () => {
  assert.equal(isWhitelistedGeminiModel({ id: "gemini-3.8-flash", provider: "google-oauth-v2", api: "google-code-assist" }), true);
  assert.equal(isWhitelistedGeminiModel({ id: "gemini-4-hydrogen-sonar", provider: "google-oauth-v2", api: "google-code-assist" }), true);
  assert.equal(isWhitelistedGeminiModel({ id: "Gemini-3.8-Flash", provider: "google", api: "google-generative-ai" }), true);
});

test("isWhitelistedGeminiModel rejects non-Gemini and proxy models", () => {
  assert.equal(isWhitelistedGeminiModel({ id: "claude-sonnet-4-6", provider: "google-oauth-v2", api: "google-code-assist" }), false);
  assert.equal(isWhitelistedGeminiModel({ id: "gpt-oss-120b", provider: "google-oauth-v2", api: "google-code-assist" }), false);
  assert.equal(isWhitelistedGeminiModel({ id: "gemini-3-flash-preview", provider: "openrouter", api: "openai-completions" }), false);
  assert.equal(isWhitelistedGeminiModel({ id: "gemini-3-flash-preview", provider: "opencode", api: "google-generative-ai" }), false);
  assert.equal(isWhitelistedGeminiModel({ id: "gemini-3-flash", provider: "google", api: "google-vertex" }), false);
  assert.equal(isWhitelistedGeminiModel({ id: "gemini-3.8-flash", provider: "google", api: "google-code-assist" }), false);
  assert.equal(isWhitelistedGeminiModel({ id: "gemini-3.8-flash", provider: "google-oauth-v2", api: "google-generative-ai" }), false);
  assert.equal(isWhitelistedGeminiModel(undefined), false);
  assert.equal(isWhitelistedGeminiModel(null), false);
  assert.equal(isWhitelistedGeminiModel({}), false);
});

test("chooseSearchProvider selects gemini for a whitelisted active model", () => {
  const activeModel = { id: "gemini-3.8-flash", provider: "google-oauth-v2", api: "google-code-assist" };
  assert.equal(chooseSearchProvider({ activeModel }), "gemini");
  assert.equal(chooseSearchProvider({ fileValue: "deepseek", activeModel }), "gemini");
});

test("chooseSearchProvider lets the environment override an active Gemini model", () => {
  const activeModel = { id: "gemini-3.8-flash", provider: "google", api: "google-generative-ai" };
  assert.equal(chooseSearchProvider({ envValue: "ddgr", fileValue: "deepseek", activeModel }), "ddgr");
  assert.equal(chooseSearchProvider({ envValue: "deepseek", activeModel }), "deepseek");
});

test("chooseSearchProvider falls back to file config for non-Gemini models", () => {
  assert.equal(chooseSearchProvider({ fileValue: "deepseek", activeModel: { id: "claude-sonnet-4-6", provider: "google-oauth-v2", api: "google-code-assist" } }), "deepseek");
  assert.equal(chooseSearchProvider({}), "ddgr");
});

test("createEmptyStreak reports once when the threshold is crossed", () => {
  const streak = createEmptyStreak();
  assert.equal(streak.recordEmpty(3), false);
  assert.equal(streak.recordEmpty(3), false);
  assert.equal(streak.recordEmpty(3), true);
  assert.equal(streak.recordEmpty(3), false);
});

test("createEmptyStreak resets after a successful search", () => {
  const streak = createEmptyStreak();
  streak.recordEmpty(2);
  streak.recordSuccess();
  assert.equal(streak.recordEmpty(2), false);
});

test("createEmptyStreak ignores a disabled threshold", () => {
  const streak = createEmptyStreak();
  assert.equal(streak.recordEmpty(0), false);
  assert.equal(streak.recordEmpty(0), false);
});
