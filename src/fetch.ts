import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_FETCH_MAX_CHARS,
  DEFAULT_FETCH_TIMEOUT_MS,
  MAX_FETCH_MAX_CHARS,
  MAX_FETCH_TIMEOUT_MS,
  type ExtractedDocument,
  type NormalizedWebFetchInput,
  type RawFetchResponse,
  type ToolRunResult,
  type WebFetchDetails,
  type WebFetchInput,
} from "./types.ts";
import { validateFetchUrl } from "./safety.ts";
import {
  applyModelVisibleCap,
  boundedExcerpt,
  saveFetchArtifacts,
  saveRawFetchArtifacts,
} from "./truncate.ts";

function normalizeInteger(value: unknown, fallback: number, max: number, name: string): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  if (Number(value) > max) {
    throw new Error(`${name} must be <= ${max}`);
  }
  return Number(value);
}

export function normalizeFetchInput(input: WebFetchInput): NormalizedWebFetchInput {
  if (!input || typeof input !== "object") throw new Error("web_fetch input must be an object");
  if (typeof input.url !== "string" || !input.url.trim()) throw new Error("url must be a non-empty string");

  return {
    url: input.url.trim(),
    timeoutMs: normalizeInteger(input.timeoutMs, DEFAULT_FETCH_TIMEOUT_MS, MAX_FETCH_TIMEOUT_MS, "timeoutMs"),
    maxChars: normalizeInteger(input.maxChars, DEFAULT_FETCH_MAX_CHARS, MAX_FETCH_MAX_CHARS, "maxChars"),
    includeComments: input.includeComments ?? false,
    includeTables: input.includeTables ?? true,
    includeLinks: input.includeLinks ?? false,
    includeImages: input.includeImages ?? false,
    fast: input.fast ?? false,
  };
}

export function buildTrafilaturaArgs(input: NormalizedWebFetchInput): string[] {
  const args = ["--xml", "--with-metadata"];
  if (!input.includeComments) args.push("--no-comments");
  if (!input.includeTables) args.push("--no-tables");
  if (input.includeLinks) args.push("--links");
  if (input.includeImages) args.push("--images");
  if (input.fast) args.push("--fast");
  args.push("-u", input.url);
  return args;
}

const MAX_RAW_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const EXPLICIT_TEXT_MEDIA_TYPES = new Set([
  "application/javascript",
  "application/json",
  "application/toml",
  "application/xml",
  "application/x-javascript",
  "application/x-yaml",
  "application/yaml",
  "text/javascript",
  "text/toml",
  "text/x-toml",
  "text/x-yaml",
]);
const BINARY_MEDIA_TYPES = new Set([
  "application/gzip",
  "application/octet-stream",
  "application/pdf",
  "application/rar",
  "application/vnd.rar",
  "application/wasm",
  "application/x-7z-compressed",
  "application/x-gzip",
  "application/zip",
]);

function getMediaType(contentType: string | undefined): string | undefined {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType || undefined;
}

function isSupportedRawMediaType(mediaType: string | undefined): boolean {
  if (!mediaType) return false;
  return mediaType.startsWith("text/")
    || EXPLICIT_TEXT_MEDIA_TYPES.has(mediaType)
    || mediaType.endsWith("+json")
    || mediaType.endsWith("+xml");
}

function isKnownBinaryMediaType(mediaType: string | undefined): boolean {
  return Boolean(mediaType && (BINARY_MEDIA_TYPES.has(mediaType) || /^(image|audio|video|font)\//.test(mediaType)));
}

function isConservativeText(body: string): boolean {
  return !body.includes("\u0000") && !body.includes("\ufffd");
}

interface RawFetchSignal {
  controller: AbortController;
  timedOut: () => boolean;
  cleanup: VoidFunction;
}

interface RawResponseHandle {
  response: Response;
  finalUrl: string;
  cleanup: VoidFunction;
  timedOut: () => boolean;
}

function createRawFetchSignal(signal: AbortSignal | undefined, timeoutMs: number): RawFetchSignal {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  return {
    controller,
    timedOut: () => didTimeout,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

async function fetchRawResponse(
  url: URL,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  fetchImplementation: typeof fetch,
): Promise<RawResponseHandle> {
  const fetchSignal = createRawFetchSignal(signal, timeoutMs);
  let currentUrl = url;

  try {
    for (let redirectCount = 0; redirectCount <= MAX_RAW_REDIRECTS; redirectCount += 1) {
      let response: Response;
      try {
        response = await fetchImplementation(currentUrl, { signal: fetchSignal.controller.signal, redirect: "manual" });
      } catch (error) {
        if (fetchSignal.timedOut()) throw new Error(`raw HTTP fallback timed out after ${timeoutMs}ms`);
        throw new Error(`raw HTTP request failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (!REDIRECT_STATUSES.has(response.status)) {
        return { response, finalUrl: currentUrl.toString(), cleanup: fetchSignal.cleanup, timedOut: fetchSignal.timedOut };
      }

      const location = response.headers.get("location");
      if (!location) return { response, finalUrl: currentUrl.toString(), cleanup: fetchSignal.cleanup, timedOut: fetchSignal.timedOut };
      if (redirectCount === MAX_RAW_REDIRECTS) {
        throw new Error(`raw HTTP fallback exceeded ${MAX_RAW_REDIRECTS} redirects`);
      }
      currentUrl = await validateFetchUrl(new URL(location, currentUrl).toString());
    }
  } catch (error) {
    fetchSignal.cleanup();
    throw error;
  }

  fetchSignal.cleanup();
  throw new Error("raw HTTP fallback failed to produce a response");
}

export async function fetchRawContent(
  url: URL,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  fetchImplementation: typeof fetch = globalThis.fetch,
): Promise<RawFetchResponse> {
  const rawResponse = await fetchRawResponse(url, signal, timeoutMs, fetchImplementation);
  const { response, finalUrl } = rawResponse;
  const contentType = response.headers.get("content-type")?.trim() || undefined;
  const mediaType = getMediaType(contentType);

  try {
    if (isKnownBinaryMediaType(mediaType)) {
      throw new Error(`raw HTTP response has unsupported binary content type ${mediaType}`);
    }

    const text = await response.text();
    if (!isSupportedRawMediaType(mediaType) && !isConservativeText(text)) {
      throw new Error(`raw HTTP response is not usable text${mediaType ? ` (content type ${mediaType})` : ""}`);
    }

    return {
      status: response.status,
      finalUrl,
      ...(contentType ? { contentType } : {}),
      text,
    };
  } catch (error) {
    if (rawResponse.timedOut()) {
      throw new Error(`raw HTTP fallback timed out after ${timeoutMs}ms`);
    }
    if (error instanceof Error && error.message.startsWith("raw HTTP")) throw error;
    throw new Error(`raw HTTP response body could not be read: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rawResponse.cleanup();
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function getDocAttributes(xml: string): Record<string, string> {
  const match = xml.match(/<doc\s+([^>]*)>/i);
  if (!match) throw new Error("Trafilatura XML did not contain a <doc> root element");

  const attrs: Record<string, string> = {};
  const attrText = match[1];
  const attrRegex = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRegex.exec(attrText)) !== null) {
    attrs[attrMatch[1]] = decodeXmlEntities(attrMatch[3] ?? attrMatch[4] ?? "");
  }
  return attrs;
}

function innerXmlForTag(xml: string, tagName: string): string | undefined {
  const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  return xml.match(regex)?.[1];
}

function stripXmlToText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<\/?(p|quote|head|row|table|list|item|cell|code|lb|br)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "\n"),
  )
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((line, index, lines) => line || lines[index - 1])
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseTrafilaturaXml(xml: string, sourceUrl: string): ExtractedDocument {
  const trimmed = xml.trim();
  if (!trimmed) throw new Error("Trafilatura returned empty XML output");

  const attrs = getDocAttributes(trimmed);
  const main = innerXmlForTag(trimmed, "main") ?? innerXmlForTag(trimmed, "body") ?? trimmed;
  const text = stripXmlToText(main);
  if (!text) throw new Error("Trafilatura XML contained no extractable text");

  return {
    url: sourceUrl,
    ...(attrs.url ? { finalUrl: attrs.url } : {}),
    ...(attrs.title ? { title: attrs.title } : {}),
    ...(attrs.author ? { author: attrs.author } : {}),
    ...(attrs.date ? { date: attrs.date } : {}),
    ...(attrs.hostname ? { hostname: attrs.hostname } : {}),
    ...(attrs.sitename ? { sitename: attrs.sitename } : {}),
    ...(attrs.description ? { description: attrs.description } : {}),
    ...(attrs.fingerprint ? { fingerprint: attrs.fingerprint } : {}),
    text,
  };
}

export function renderFetchContent(details: WebFetchDetails): string {
  const header: string[] = [`web_fetch: ${details.finalUrl ?? details.url}`];
  if (details.provider === "http") {
    const contentType = details.contentType ? `: ${details.contentType}` : "";
    const status = details.status === undefined ? "" : ` (HTTP ${details.status})`;
    header.push(`Raw HTTP response${contentType}${status}`);
  }
  if (details.title) header.push(`Title: ${details.title}`);
  if (details.author) header.push(`Author: ${details.author}`);
  if (details.date) header.push(`Date: ${details.date}`);
  if (details.hostname) header.push(`Host: ${details.hostname}`);
  if (details.truncated && details.fullTextPath) {
    header.push(`Full text: ${details.fullTextPath}`);
  }
  if (details.truncated && details.fullXmlPath) {
    header.push(`Full XML: ${details.fullXmlPath}`);
  }

  return `${header.join("\n")}\n\n${details.text}`;
}

export async function runWebFetch(
  pi: Pick<ExtensionAPI, "exec">,
  input: WebFetchInput,
  signal?: AbortSignal,
): Promise<ToolRunResult<WebFetchDetails>> {
  const normalized = normalizeFetchInput(input);
  const safeUrl = await validateFetchUrl(normalized.url);
  const safeInput = { ...normalized, url: safeUrl.toString() };
  const args = buildTrafilaturaArgs(safeInput);

  const result = await pi.exec("trafilatura", args, { signal, timeout: normalized.timeoutMs });
  if (result.killed) {
    throw new Error(`trafilatura timed out after ${normalized.timeoutMs}ms`);
  }
  if (result.code !== 0) {
    throw new Error(
      `trafilatura failed with exit code ${result.code}\nstdout:\n${boundedExcerpt(result.stdout)}\nstderr:\n${boundedExcerpt(result.stderr)}`,
    );
  }

  const xml = result.stdout.trim();
  let doc: ExtractedDocument;
  try {
    doc = parseTrafilaturaXml(xml, safeInput.url);
  } catch (error) {
    const extractionError = error instanceof Error ? error.message : String(error);
    try {
      const raw = await fetchRawContent(new URL(safeInput.url), signal, normalized.timeoutMs);
      return buildRawFetchResult(raw, safeInput, result.stderr);
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`trafilatura extraction failed: ${extractionError}; raw HTTP fallback failed: ${fallbackMessage}`);
    }
  }

  return buildTrafilaturaResult(doc, xml, args, safeInput.maxChars, result.stderr);
}

async function buildTrafilaturaResult(
  doc: ExtractedDocument,
  xml: string,
  args: string[],
  maxChars: number,
  stderr: string,
): Promise<ToolRunResult<WebFetchDetails>> {
  const capped = applyModelVisibleCap(doc.text, maxChars);
  const artifacts = capped.truncated ? await saveFetchArtifacts(xml, doc.text) : undefined;
  const details = createTrafilaturaDetails(doc, args, capped, artifacts, stderr);
  return { contentText: renderFetchContent(details), details };
}

function createTrafilaturaDetails(
  doc: ExtractedDocument,
  args: string[],
  capped: ReturnType<typeof applyModelVisibleCap>,
  artifacts: Awaited<ReturnType<typeof saveFetchArtifacts>> | undefined,
  stderr: string,
): WebFetchDetails {
  return {
    ...doc,
    provider: "trafilatura",
    args,
    text: capped.content,
    truncated: capped.truncated,
    ...(capped.truncation ? { truncation: capped.truncation } : {}),
    ...(artifacts ? artifacts : {}),
    ...(stderr.trim() ? { stderr: boundedExcerpt(stderr.trim()) } : {}),
  };
}

async function buildRawFetchResult(
  raw: RawFetchResponse,
  input: NormalizedWebFetchInput,
  stderr: string,
): Promise<ToolRunResult<WebFetchDetails>> {
  const capped = applyModelVisibleCap(raw.text, input.maxChars, "Full text path is available in tool details.");
  const artifacts = capped.truncated ? await saveRawFetchArtifacts(raw.text) : undefined;
  const finalUrl = new URL(raw.finalUrl);
  const details: WebFetchDetails = {
    url: input.url,
    finalUrl: raw.finalUrl,
    hostname: finalUrl.hostname,
    provider: "http",
    args: [],
    text: capped.content,
    truncated: capped.truncated,
    status: raw.status,
    ...(raw.contentType ? { contentType: raw.contentType } : {}),
    ...(capped.truncation ? { truncation: capped.truncation } : {}),
    ...artifacts,
    ...(stderr.trim() ? { stderr: boundedExcerpt(stderr.trim()) } : {}),
  };

  return { contentText: renderFetchContent(details), details };
}
