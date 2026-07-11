import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTrafilaturaArgs,
  fetchRawContent,
  normalizeFetchInput,
  parseTrafilaturaXml,
  renderFetchContent,
  runWebFetch,
} from "../src/fetch.ts";
import { applyModelVisibleCap, saveFetchArtifacts, saveRawFetchArtifacts } from "../src/truncate.ts";

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

test("saveRawFetchArtifacts writes only full text", async () => {
  const artifacts = await saveRawFetchArtifacts("full raw text");
  assert.match(artifacts.tempDir, /pi-web-/);
  assert.equal(artifacts.fullXmlPath, undefined);
  assert.equal(await readFile(artifacts.fullTextPath, "utf8"), "full raw text");
});

test("fetchRawContent preserves JSON with Content-Type parameters", async () => {
  const response = await fetchRawContent(
    new URL("https://example.com/data.json"),
    undefined,
    1_000,
    async () => new Response('{"name":"example"}', {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.contentType, "application/json; charset=utf-8");
  assert.equal(response.text, '{"name":"example"}');
});

test("fetchRawContent rejects binary responses", async () => {
  await assert.rejects(
    () => fetchRawContent(
      new URL("https://example.com/file.pdf"),
      undefined,
      1_000,
      async () => new Response(new Uint8Array([0, 1, 2]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    ),
    /unsupported binary content type application\/pdf/,
  );
});

test("runWebFetch falls back to raw text when extraction is empty", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("const answer = 42;\n", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
    const result = await runWebFetch({
      async exec() {
        return { stdout: "", stderr: "", code: 0, killed: false };
      },
    }, { url: "https://93.184.216.34/source.js" });

    assert.equal(result.details.provider, "http");
    assert.equal(result.details.status, 200);
    assert.equal(result.details.contentType, "text/plain; charset=utf-8");
    assert.equal(result.details.text, "const answer = 42;\n");
    assert.match(result.contentText, /Raw HTTP response/);
    assert.match(result.contentText, /text\/plain/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runWebFetch preserves HTML extraction results", async () => {
  const result = await runWebFetch({
    async exec() {
      return { stdout: xml, stderr: "", code: 0, killed: false };
    },
  }, { url: "https://93.184.216.34/article" });

  assert.equal(result.details.provider, "trafilatura");
  assert.equal(result.details.title, "Example & Test");
  assert.match(result.details.text, /Hello/);
});

test("runWebFetch saves only a text artifact for capped raw content", async () => {
  const originalFetch = globalThis.fetch;
  const rawText = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
  try {
    globalThis.fetch = async () => new Response(rawText, {
      status: 200,
      headers: { "content-type": "text/markdown" },
    });
    const result = await runWebFetch({
      async exec() {
        return { stdout: "", stderr: "", code: 0, killed: false };
      },
    }, { url: "https://93.184.216.34/README.md", maxChars: 40 });

    assert.equal(result.details.truncated, true);
    assert.equal(result.details.fullXmlPath, undefined);
    assert.ok(result.details.fullTextPath);
    assert.equal(await readFile(result.details.fullTextPath, "utf8"), rawText);
    assert.match(result.contentText, /Full text:/);
    assert.doesNotMatch(result.contentText, /Full XML:/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runWebFetch does not fall back after a trafilatura timeout", async () => {
  await assert.rejects(
    () => runWebFetch({
      async exec() {
        return { stdout: "", stderr: "", code: 0, killed: true };
      },
    }, { url: "https://93.184.216.34/source" }),
    /trafilatura timed out/,
  );
});

test("runWebFetch keeps non-2xx text response status", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("not found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
    const result = await runWebFetch({
      async exec() {
        return { stdout: "<html></html>", stderr: "", code: 0, killed: false };
      },
    }, { url: "https://93.184.216.34/missing" });

    assert.equal(result.details.provider, "http");
    assert.equal(result.details.status, 404);
    assert.equal(result.details.text, "not found");
  } finally {
    globalThis.fetch = originalFetch;
  }
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
