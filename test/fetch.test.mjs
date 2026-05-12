import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTrafilaturaArgs, normalizeFetchInput, parseTrafilaturaXml, renderFetchContent } from "../src/fetch.ts";
import { applyModelVisibleCap, saveFetchArtifacts } from "../src/truncate.ts";

const xml = `<doc sitename="example" title="Example &amp; Test" author="A. Author" date="2026-05-12" url="https://example.com/doc" hostname="example.com" description="Desc" fingerprint="abc">
  <main><p>Hello <code>world</code>.</p><p>Second &lt;line&gt;.</p><quote>A quote.</quote></main>
</doc>`;

test("normalizeFetchInput sets defaults", () => {
  const normalized = normalizeFetchInput({ url: " https://example.com " });
  assert.equal(normalized.url, "https://example.com");
  assert.equal(normalized.timeoutMs, 20_000);
  assert.equal(normalized.maxChars, 12_000);
  assert.equal(normalized.includeComments, false);
  assert.equal(normalized.includeTables, true);
});

test("buildTrafilaturaArgs includes XML defaults and optional flags", () => {
  const args = buildTrafilaturaArgs(normalizeFetchInput({
    url: "https://example.com",
    includeComments: false,
    includeTables: false,
    includeLinks: true,
    includeImages: true,
    fast: true,
  }));
  assert.deepEqual(args, [
    "--xml",
    "--with-metadata",
    "--no-comments",
    "--no-tables",
    "--links",
    "--images",
    "--fast",
    "-u",
    "https://example.com",
  ]);
});

test("parseTrafilaturaXml extracts metadata and readable text", () => {
  const doc = parseTrafilaturaXml(xml, "https://input.example");
  assert.equal(doc.url, "https://input.example");
  assert.equal(doc.finalUrl, "https://example.com/doc");
  assert.equal(doc.title, "Example & Test");
  assert.equal(doc.author, "A. Author");
  assert.equal(doc.hostname, "example.com");
  assert.match(doc.text, /Hello/);
  assert.match(doc.text, /world/);
  assert.match(doc.text, /Second <line>\./);
  assert.match(doc.text, /A quote\./);
});

test("parseTrafilaturaXml rejects empty or malformed XML", () => {
  assert.throws(() => parseTrafilaturaXml("", "https://example.com"), /empty XML/);
  assert.throws(() => parseTrafilaturaXml("<html></html>", "https://example.com"), /<doc>/);
});

test("applyModelVisibleCap caps long text", () => {
  const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
  const capped = applyModelVisibleCap(text, 120);
  assert.equal(capped.truncated, true);
  assert.match(capped.content, /Output capped/);
  assert.ok(capped.truncation);
});

test("saveFetchArtifacts writes full XML and text", async () => {
  const artifacts = await saveFetchArtifacts("<doc />", "full text");
  assert.match(artifacts.tempDir, /pi-web-/);
  assert.equal(await readFile(artifacts.fullXmlPath, "utf8"), "<doc />");
  assert.equal(await readFile(artifacts.fullTextPath, "utf8"), "full text");
});

test("renderFetchContent includes temp paths when capped", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-web-test-"));
  const rendered = renderFetchContent({
    provider: "trafilatura",
    args: [],
    url: "https://example.com",
    finalUrl: "https://example.com/doc",
    title: "Example",
    hostname: "example.com",
    text: "Short text",
    truncated: true,
    fullTextPath: join(tempDir, "document.txt"),
    fullXmlPath: join(tempDir, "document.xml"),
  });
  assert.match(rendered, /Full text:/);
  assert.match(rendered, /Full XML:/);
  assert.match(rendered, /Short text/);
});
