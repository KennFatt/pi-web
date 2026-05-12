import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_FETCH_MAX_CHARS,
  DEFAULT_FETCH_TIMEOUT_MS,
  MAX_FETCH_MAX_CHARS,
  MAX_FETCH_TIMEOUT_MS,
  type ExtractedDocument,
  type NormalizedWebFetchInput,
  type ToolRunResult,
  type WebFetchDetails,
  type WebFetchInput,
} from "./types.ts";
import { validateFetchUrl } from "./safety.ts";
import { applyModelVisibleCap, boundedExcerpt, saveFetchArtifacts } from "./truncate.ts";

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
  const doc = parseTrafilaturaXml(xml, safeInput.url);
  const capped = applyModelVisibleCap(doc.text, safeInput.maxChars);
  const artifacts = capped.truncated ? await saveFetchArtifacts(xml, doc.text) : undefined;

  const details: WebFetchDetails = {
    ...doc,
    provider: "trafilatura",
    args,
    text: capped.content,
    truncated: capped.truncated,
    ...(capped.truncation ? { truncation: capped.truncation } : {}),
    ...(artifacts ? artifacts : {}),
    ...(result.stderr.trim() ? { stderr: boundedExcerpt(result.stderr.trim()) } : {}),
  };

  return {
    contentText: renderFetchContent(details),
    details,
  };
}
